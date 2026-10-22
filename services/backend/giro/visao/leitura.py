"""Transforma as pessoas encontradas na foto em números por mesa: quantas sentadas, quantas em pé.

Cada mesa tem um desenho (polígono) feito pelo técnico sobre a imagem da câmera, cobrindo a mesa
e as cadeiras. A regra, que precisa ser calibrada com vídeo real de cada salão:

- Sentada na mesa: pessoa "baixa" (caixa pouco mais alta que larga) cujo ponto de apoio, o meio
  da base da caixa, cai dentro do desenho da mesa.
- Em pé junto à mesa (o garçom): pessoa "alta" (caixa bem mais alta que larga) com o ponto de
  apoio dentro do desenho ou até `margem_atendimento` de distância dele.
- Se o ponto cai em mais de uma mesa, vale a mais próxima.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from giro.visao.detector import Pessoa

Ponto = tuple[float, float]


@dataclass(frozen=True)
class Ajustes:
    """Calibração por câmera (guardada em `cameras.ajustes_visao`)."""

    proporcao_em_pe: float = 2.2  # altura/largura acima disso = pessoa em pé
    margem_atendimento: float = 0.05  # até onde, fora do desenho, o garçom em pé ainda conta
    confianca_minima: float = 0.35

    @classmethod
    def de_dict(cls, dados: dict[str, Any] | None) -> Ajustes:
        dados = dados or {}
        return cls(**{c: float(dados[c]) for c in cls.__dataclass_fields__ if c in dados})


@dataclass(frozen=True)
class ZonaMesa:
    numero: int
    poligono: list[Ponto]

    @property
    def centro(self) -> Ponto:
        xs, ys = zip(*self.poligono, strict=True)
        return (sum(xs) / len(xs), sum(ys) / len(ys))


@dataclass(frozen=True)
class PessoaLida:
    pessoa: Pessoa
    em_pe: bool
    mesa: int | None  # None = não está em nenhuma mesa (corredor, balcão, porta)


@dataclass(frozen=True)
class Leitura:
    pessoas: list[PessoaLida]
    por_mesa: dict[int, tuple[int, int]]  # número da mesa -> (sentados, em pé)

    def observacoes(self) -> list[dict[str, int]]:
        """No formato de POST /api/ingest/observacoes."""
        return [
            {"mesa": numero, "sentados": sentados, "em_pe": em_pe}
            for numero, (sentados, em_pe) in sorted(self.por_mesa.items())
        ]


def dentro(ponto: Ponto, poligono: list[Ponto]) -> bool:
    """O ponto está dentro do polígono? (contagem de cruzamentos de um raio horizontal)."""
    x, y = ponto
    resultado = False
    j = len(poligono) - 1
    for i in range(len(poligono)):
        xi, yi = poligono[i]
        xj, yj = poligono[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            resultado = not resultado
        j = i
    return resultado


def distancia(ponto: Ponto, poligono: list[Ponto]) -> float:
    """Distância do ponto até o polígono (zero se estiver dentro)."""
    if dentro(ponto, poligono):
        return 0.0
    px, py = ponto
    menor = math.inf
    for i in range(len(poligono)):
        (ax, ay), (bx, by) = poligono[i - 1], poligono[i]
        dx, dy = bx - ax, by - ay
        comprimento = dx * dx + dy * dy
        t = (
            0.0
            if comprimento == 0
            else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / comprimento))
        )
        menor = min(menor, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
    return menor


def ler(pessoas: list[Pessoa], zonas: list[ZonaMesa], ajustes: Ajustes) -> Leitura:
    contagem = {zona.numero: [0, 0] for zona in zonas}
    lidas = []
    for pessoa in pessoas:
        if pessoa.confianca < ajustes.confianca_minima:
            continue
        em_pe = pessoa.proporcao >= ajustes.proporcao_em_pe
        mesa = _mesa_da_pessoa(pessoa.apoio, zonas, ajustes.margem_atendimento if em_pe else 0)
        if mesa is not None:
            contagem[mesa][1 if em_pe else 0] += 1
        lidas.append(PessoaLida(pessoa=pessoa, em_pe=em_pe, mesa=mesa))
    return Leitura(pessoas=lidas, por_mesa={numero: (s, e) for numero, (s, e) in contagem.items()})


def _mesa_da_pessoa(apoio: Ponto, zonas: list[ZonaMesa], margem: float) -> int | None:
    candidatas = []
    for zona in zonas:
        d = distancia(apoio, zona.poligono)
        if d <= margem:
            cx, cy = zona.centro
            candidatas.append((d, math.hypot(apoio[0] - cx, apoio[1] - cy), zona.numero))
    return min(candidatas)[2] if candidatas else None
