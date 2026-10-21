"""Cenários de salão: uma linha do tempo do que acontece em cada mesa e o que o sistema deve fazer.

Os cenários ficam em `cenarios/*.yaml` e servem para duas coisas:
- testar a máquina de estados (rodar_local + verificar), sem banco e sem esperar o relógio;
- fazer demonstração ao vivo mandando as observações para a API (veja ao_vivo.py).
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

import yaml

from giro.dominio.mesa import Evento, MaquinaMesa, Observacao, Regras, TipoEvento

PASTA_CENARIOS = Path(__file__).parent / "cenarios"
INTERVALO = timedelta(seconds=10)  # uma foto a cada 10 segundos, como o DVR do restaurante
FOLGA_FINAL = timedelta(minutes=3)


def ler_tempo(texto: str | int) -> timedelta:
    """'5:00' = 5 minutos, '1:10:00' = 1h10, 90 = 90 segundos."""
    if isinstance(texto, int):
        return timedelta(seconds=texto)
    partes = [int(p) for p in str(texto).split(":")]
    while len(partes) < 3:
        partes.insert(0, 0)
    horas, minutos, segundos = partes
    return timedelta(hours=horas, minutes=minutos, seconds=segundos)


def mostrar_tempo(delta: timedelta) -> str:
    total = int(delta.total_seconds())
    return f"{total // 60}:{total % 60:02d}"


@dataclass(frozen=True)
class Passo:
    em: timedelta
    mesa: int
    sentados: int | None = None
    em_pe: int | None = None
    acao: str | None = None  # "liberar": a equipe toca no celular


@dataclass(frozen=True)
class Esperado:
    em: timedelta
    mesa: int
    tipo: TipoEvento
    tolerancia: timedelta = timedelta(seconds=10)


@dataclass
class Cenario:
    nome: str
    descricao: str
    passos: list[Passo]
    esperados: list[Esperado] = field(default_factory=list)
    verificavel: bool = True  # cenários aleatórios não têm resultado esperado

    @property
    def mesas(self) -> list[int]:
        return sorted({p.mesa for p in self.passos})

    @property
    def duracao(self) -> timedelta:
        return max(p.em for p in self.passos) + FOLGA_FINAL

    def estado_em(self, t: timedelta) -> dict[int, tuple[int, int]]:
        """(sentados, em pé) de cada mesa no instante t."""
        estado = {mesa: (0, 0) for mesa in self.mesas}
        for passo in sorted(self.passos, key=lambda p: p.em):
            if passo.em > t:
                break
            sentados, em_pe = estado[passo.mesa]
            estado[passo.mesa] = (
                passo.sentados if passo.sentados is not None else sentados,
                passo.em_pe if passo.em_pe is not None else em_pe,
            )
        return estado

    def acoes_entre(self, de: timedelta, ate: timedelta) -> list[Passo]:
        return [p for p in self.passos if p.acao and de < p.em <= ate]


def carregar(caminho: Path) -> Cenario:
    dados = yaml.safe_load(caminho.read_text(encoding="utf-8"))
    return Cenario(
        nome=caminho.stem,
        descricao=dados.get("descricao", "").strip(),
        passos=[
            Passo(
                em=ler_tempo(p["em"]),
                mesa=p["mesa"],
                sentados=p.get("sentados"),
                em_pe=p.get("em_pe"),
                acao=p.get("acao"),
            )
            for p in dados["linha_do_tempo"]
        ],
        esperados=[
            Esperado(
                em=ler_tempo(e["em"]),
                mesa=e["mesa"],
                tipo=TipoEvento(e["tipo"]),
                tolerancia=ler_tempo(e.get("tolerancia", 10)),
            )
            for e in dados.get("esperado", [])
        ],
    )


def todos() -> list[Cenario]:
    return [carregar(c) for c in sorted(PASTA_CENARIOS.glob("*.yaml"))]


def por_nome(nome: str) -> Cenario:
    caminho = PASTA_CENARIOS / f"{nome}.yaml"
    if not caminho.exists():
        disponiveis = ", ".join(c.nome for c in todos())
        raise SystemExit(f"cenário '{nome}' não existe. Disponíveis: {disponiveis}")
    return carregar(caminho)


# Rodar sem API: máquina de estados pura, relógio simulado.

INICIO_LOCAL = datetime(2026, 1, 2, 20, 0, tzinfo=UTC)  # uma sexta às 20h


@dataclass(frozen=True)
class Ocorrido:
    em: timedelta
    mesa: int
    tipo: TipoEvento


def rodar_local(cenario: Cenario, regras: Regras | None = None) -> list[Ocorrido]:
    regras = regras or Regras()
    maquinas = {mesa: MaquinaMesa(regras=regras) for mesa in cenario.mesas}
    ocorridos: list[Ocorrido] = []

    def registrar(mesa: int, eventos: list[Evento]) -> None:
        ocorridos.extend(Ocorrido(e.em - INICIO_LOCAL, mesa, e.tipo) for e in eventos)

    t = timedelta(0)
    anterior = -INTERVALO
    while t <= cenario.duracao:
        for passo in cenario.acoes_entre(anterior, t):
            if passo.acao == "liberar":
                maquina = maquinas[passo.mesa]
                registrar(passo.mesa, maquina.liberar(INICIO_LOCAL + passo.em))
        for mesa, (sentados, em_pe) in cenario.estado_em(t).items():
            registrar(mesa, maquinas[mesa].observar(Observacao(INICIO_LOCAL + t, sentados, em_pe)))
        anterior = t
        t += INTERVALO
    return ocorridos


def verificar(cenario: Cenario, ocorridos: list[Ocorrido]) -> list[str]:
    """Tudo o que era esperado aconteceu, na hora certa, e nada além disso."""
    falhas = []
    sobrando = list(ocorridos)
    for esperado in cenario.esperados:
        achado = next(
            (
                o
                for o in sobrando
                if o.mesa == esperado.mesa
                and o.tipo == esperado.tipo
                and abs(o.em - esperado.em) <= esperado.tolerancia
            ),
            None,
        )
        if achado is None:
            falhas.append(
                f"faltou: mesa {esperado.mesa} {esperado.tipo.value} "
                f"por volta de {mostrar_tempo(esperado.em)}"
            )
        else:
            sobrando.remove(achado)
    falhas += [
        f"inesperado: mesa {o.mesa} {o.tipo.value} em {mostrar_tempo(o.em)}" for o in sobrando
    ]
    return falhas


# Noite aleatória para demonstração ao vivo.


def gerar_noite(
    mesas: list[int], duracao_min: int = 120, ritmo: str = "real", semente: int | None = None
) -> Cenario:
    """Clientes chegando, sendo atendidos (alguns com demora), saindo e mesas esperando limpeza.

    ritmo "demo" encurta a permanência para dar para ver o giro em poucos minutos.
    """
    sorteio = random.Random(semente)  # noqa: S311 (simulação, não é segurança)
    permanencia = (6, 15) if ritmo == "demo" else (35, 80)
    limpeza = (1, 5) if ritmo == "demo" else (2, 12)
    passos: list[Passo] = []
    fim = timedelta(minutes=duracao_min)

    for mesa in mesas:
        t = timedelta(minutes=sorteio.uniform(0, 8))
        while t < fim:
            pessoas = sorteio.randint(1, 4)
            passos.append(Passo(t, mesa, sentados=pessoas, em_pe=0))
            chance = sorteio.random()
            if chance < 0.08:  # desiste antes de ser atendido
                t += timedelta(minutes=sorteio.uniform(3, 4.5))
                passos.append(Passo(t, mesa, sentados=0))
            else:
                if chance < 0.70:
                    espera = sorteio.uniform(1, 3)
                elif chance < 0.90:
                    espera = sorteio.uniform(3, 4.8)
                else:
                    espera = sorteio.uniform(5.5, 8)  # vai gerar alerta
                atendimento = t + timedelta(minutes=espera)
                passos.append(Passo(atendimento, mesa, em_pe=1))
                passos.append(Passo(atendimento + timedelta(seconds=40), mesa, em_pe=0))
                t = atendimento + timedelta(minutes=sorteio.uniform(*permanencia))
                passos.append(Passo(t, mesa, sentados=0))
            t += timedelta(minutes=sorteio.uniform(*limpeza))

    return Cenario(
        nome="noite-aleatoria",
        descricao=f"Noite gerada ao acaso ({ritmo}, {len(mesas)} mesas, {duracao_min} min).",
        passos=sorted(passos, key=lambda p: p.em),
        verificavel=False,
    )
