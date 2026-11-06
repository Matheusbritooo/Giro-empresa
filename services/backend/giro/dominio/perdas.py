"""Perdas do estoque, sem banco nem API: quanto deveria ter saído pela ficha, quanto saiu de
verdade e o que escapou no meio; a curva ABC dos ingredientes; e quando o preço de um
ingrediente subiu de uma compra para a outra.

Pelo livro do estoque, num período, para cada ingrediente:

    pela ficha        = o que os pratos vendidos levam (vendas menos estornos)
    perda registrada  = o que alguém lançou como perda, com o motivo
    sem registro      = o que a contagem achou a menos que a conta
    saiu de verdade   = pela ficha + registrada + sem registro
                      = estoque do começo + compras − estoque do fim

A diferença sem registro só aparece quando alguém conta o estoque. É nela que mora a porção
maior que a ficha, o desperdício que ninguém anotou, o erro de contagem e o desvio.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from giro.dominio.estoque import base_do_preco

LIMITE_SUBIDA_PCT = 10  # compra que sobe o preço mais que isso avisa o dono
CORTE_A, CORTE_B = 0.80, 0.95  # curva ABC


@dataclass(frozen=True)
class Movimentos:
    """Somas do período no livro, com o sinal do livro (saída negativa)."""

    venda: int = 0
    estorno: int = 0
    perda: int = 0
    contagem: int = 0


@dataclass(frozen=True)
class PerdaDoInsumo:
    pela_ficha: int
    registrada: int
    sem_registro: int  # positiva quando sumiu; negativa quando a contagem achou a mais

    @property
    def escapou(self) -> int:
        return self.registrada + self.sem_registro

    @property
    def saiu(self) -> int:
        return self.pela_ficha + self.escapou


def perda_do_insumo(m: Movimentos) -> PerdaDoInsumo:
    return PerdaDoInsumo(
        pela_ficha=-(m.venda + m.estorno), registrada=-m.perda, sem_registro=-m.contagem
    )


def curva_abc(valores: dict[int, float]) -> dict[int, str]:
    """A: os poucos que somam 80% do gasto (o que cruza a linha também é A); B: até 95%;
    C: o resto. São os da curva A que valem uma contagem toda semana."""
    total = sum(v for v in valores.values() if v > 0)
    classes = {}
    acumulado = 0.0
    for item, valor in sorted(valores.items(), key=lambda kv: (-kv[1], kv[0])):
        if valor <= 0 or total == 0:
            classes[item] = "C"
            continue
        antes = acumulado / total
        acumulado += valor
        classes[item] = "A" if antes < CORTE_A else "B" if antes < CORTE_B else "C"
    return classes


def preco_da_nota(quantidade: int, valor_centavos: int, unidade: str) -> int:
    """Preço por kg, litro ou unidade que a nota cobrou."""
    return round(valor_centavos * base_do_preco(unidade) / quantidade)


@dataclass(frozen=True)
class Subida:
    antes_centavos: int  # por kg, litro ou unidade
    agora_centavos: int

    @property
    def pct(self) -> int:
        return round((self.agora_centavos / self.antes_centavos - 1) * 100)


def subida_de_preco(antes: int | None, agora: int | None) -> Subida | None:
    """A compra subiu o preço mais que o limite? None quando não subiu (ou não dá para dizer)."""
    if not antes or agora is None:
        return None
    if agora * 100 >= antes * (100 + LIMITE_SUBIDA_PCT):
        return Subida(antes, agora)
    return None


def impacto_no_prato(subida: Subida, por_porcao: int, unidade: str) -> int:
    """Quanto o prato passou a custar a mais, em centavos, com o preço novo."""
    diferenca = subida.agora_centavos - subida.antes_centavos
    return round(diferenca * por_porcao / base_do_preco(unidade))


def subida_recente(
    notas: list[tuple[datetime, int]], desde: datetime
) -> tuple[Subida, datetime] | None:
    """A última compra, desde `desde`, que subiu o preço mais que o limite em relação à
    nota anterior, se o preço continua alto até a nota mais recente. `notas` vem da mais
    antiga para a mais recente: (quando, preço por kg, litro ou unidade).

    Devolve a subida (do preço de antes até o de agora) e quando ela aconteceu."""
    for i in range(len(notas) - 1, 0, -1):
        (_, antes), (quando, depois) = notas[i - 1], notas[i]
        if quando < desde:
            break
        if subida_de_preco(antes, depois) is not None:
            agora = notas[-1][1]
            subida = subida_de_preco(antes, agora)
            return (subida, quando) if subida is not None else None
    return None
