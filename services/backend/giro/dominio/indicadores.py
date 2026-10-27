"""Indicadores do salão a partir das visitas às mesas (tabela `ocupacoes`).

Só conta: recebe as visitas de um período e devolve os números que o dono entende (quantas
mesas atendeu, quanto o cliente esperou, quanto tempo a mesa ficou suja, quanto dinheiro isso
custou). Não conhece banco nem API, como `mesa.py`.

Horário local: São Paulo, UTC-3 o ano todo (o Brasil não tem horário de verão desde 2019).
Uma "noite" vai das 6h de um dia às 6h do dia seguinte: o jantar que passa da meia-noite
conta na noite em que começou.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

FUSO = timezone(timedelta(hours=-3))
VIRADA = time(6, 0)  # quando uma noite termina e a próxima começa

# Hora com o salão pelo menos 75% ocupado: mesa parada nessa hora é cliente que não sentou.
LIMIAR_CHEIO = 0.75
# Os primeiros minutos de limpeza não têm como evitar: não entram no prejuízo.
LIMPEZA_NORMAL = timedelta(minutes=3)


@dataclass(frozen=True)
class Visita:
    """Uma visita à mesa: sentou, foi atendida, saiu, foi liberada."""

    mesa_numero: int
    sentou_em: datetime
    atendida_em: datetime | None
    saiu_em: datetime | None
    liberada_em: datetime | None
    pessoas: int
    sem_atendimento: bool = False

    @property
    def atendida(self) -> bool:
        return not self.sem_atendimento

    def espera(self) -> timedelta | None:
        """Do sentar até alguém da equipe chegar na mesa."""
        if self.atendida_em is None:
            return None
        return self.atendida_em - self.sentou_em

    def parada(self) -> timedelta | None:
        """Da saída dos clientes até a mesa ser liberada (a mesa parada)."""
        if self.sem_atendimento or self.saiu_em is None or self.liberada_em is None:
            return None
        return max(self.liberada_em - self.saiu_em, timedelta(0))

    def fim(self, ate: datetime) -> datetime:
        """Até quando a mesa ficou indisponível para a próxima turma."""
        return min(self.liberada_em or self.saiu_em or ate, ate)


@dataclass(frozen=True)
class MesaInfo:
    numero: int
    lugares: int


@dataclass
class PorHora:
    hora: int  # hora local, 0 a 23
    chegadas: float  # média de turmas que sentaram nessa hora, por noite
    ocupacao: float  # fração do tempo das mesas ocupado, de 0 a 1


@dataclass
class PorMesa:
    numero: int
    lugares: int
    visitas: int
    desistencias: int
    espera_media_seg: float | None
    parada_media_seg: float | None
    parada_total_seg: float
    perdido_centavos: int


@dataclass
class Indicadores:
    inicio: datetime
    fim: datetime
    noites: int  # noites com movimento no período
    mesas_atendidas: int
    pessoas_atendidas: int
    desistencias: int
    pessoas_desistiram: int
    giro_medio: float  # turmas atendidas por mesa, por noite
    espera_media_seg: float | None
    esperas_acima_do_limite: int
    permanencia_media_seg: float | None
    parada_media_seg: float | None
    parada_total_seg: float
    hora_pico: int | None
    ticket_medio_centavos: int
    perdido_desistencias_centavos: int
    perdido_mesa_parada_centavos: int
    por_hora: list[PorHora] = field(default_factory=list)
    por_mesa: list[PorMesa] = field(default_factory=list)

    @property
    def perdido_total_centavos(self) -> int:
        return self.perdido_desistencias_centavos + self.perdido_mesa_parada_centavos


def noite_de(momento: datetime) -> date:
    """A noite a que um instante pertence (antes das 6h ainda é a noite anterior)."""
    local = momento.astimezone(FUSO)
    return local.date() - timedelta(days=1) if local.time() < VIRADA else local.date()


def intervalo_da_noite(dia: date) -> tuple[datetime, datetime]:
    inicio = datetime.combine(dia, VIRADA, FUSO)
    return inicio, inicio + timedelta(days=1)


def _media(valores: list[float]) -> float | None:
    return sum(valores) / len(valores) if valores else None


def _sobreposicao(a: datetime, b: datetime, c: datetime, d: datetime) -> float:
    """Segundos em comum entre [a, b] e [c, d]."""
    return max((min(b, d) - max(a, c)).total_seconds(), 0.0)


def _horas_do_periodo(inicio: datetime, fim: datetime) -> list[datetime]:
    hora = inicio.replace(minute=0, second=0, microsecond=0)
    horas = []
    while hora < fim:
        horas.append(hora)
        hora += timedelta(hours=1)
    return horas


def ocupacao_por_hora(
    visitas: list[Visita], n_mesas: int, inicio: datetime, fim: datetime
) -> dict[datetime, float]:
    """Para cada hora do período, a fração do tempo das mesas que estava ocupada (0 a 1)."""
    if n_mesas == 0:
        return {}
    ocupado: dict[datetime, float] = defaultdict(float)
    for v in visitas:
        fim_visita = v.fim(fim)
        hora = v.sentou_em.replace(minute=0, second=0, microsecond=0)
        while hora < fim_visita:
            ocupado[hora] += _sobreposicao(v.sentou_em, fim_visita, hora, hora + timedelta(hours=1))
            hora += timedelta(hours=1)
    return {h: min(ocupado[h] / (n_mesas * 3600), 1.0) for h in _horas_do_periodo(inicio, fim)}


def horas_cheias(ocupacao: dict[datetime, float]) -> list[datetime]:
    return [h for h, fracao in ocupacao.items() if fracao >= LIMIAR_CHEIO]


def parada_em_horas_cheias(visita: Visita, tolerancia: timedelta, cheias: list[datetime]) -> float:
    """Segundos de mesa parada além da `tolerancia` que caíram em horas de salão cheio."""
    parada = visita.parada()
    if parada is None or parada <= tolerancia or visita.saiu_em is None:
        return 0.0
    de, ate = visita.saiu_em + tolerancia, visita.saiu_em + parada
    return sum(_sobreposicao(de, ate, h, h + timedelta(hours=1)) for h in cheias)


def calcular(
    visitas: list[Visita],
    mesas: list[MesaInfo],
    inicio: datetime,
    fim: datetime,
    *,
    ticket_medio_centavos: int,
    limite_alerta: timedelta,
) -> Indicadores:
    """Indicadores das visitas que começaram entre `inicio` e `fim`."""
    visitas = [v for v in visitas if inicio <= v.sentou_em < fim]
    atendidas = [v for v in visitas if v.atendida]
    desistiram = [v for v in visitas if v.sem_atendimento]
    noites = len({noite_de(v.sentou_em) for v in visitas})

    esperas = [e.total_seconds() for v in atendidas if (e := v.espera()) is not None]
    paradas = [p.total_seconds() for v in atendidas if (p := v.parada()) is not None]
    permanencias = [
        (v.saiu_em - v.sentou_em).total_seconds() for v in atendidas if v.saiu_em is not None
    ]
    pessoas_por_turma = _media([float(v.pessoas) for v in atendidas]) or 0.0
    permanencia_media = _media(permanencias)

    ocupacao = ocupacao_por_hora(visitas, len(mesas), inicio, fim)
    cheias = horas_cheias(ocupacao)

    def valor_da_parada(segundos: float) -> int:
        """Mesa parada em hora cheia vira turmas que poderiam ter sentado, em centavos."""
        if not permanencia_media or segundos <= 0:
            return 0
        turmas = segundos / permanencia_media
        return round(turmas * pessoas_por_turma * ticket_medio_centavos)

    excesso_por_mesa: dict[int, float] = defaultdict(float)
    for v in atendidas:
        excesso_por_mesa[v.mesa_numero] += parada_em_horas_cheias(v, LIMPEZA_NORMAL, cheias)

    # Por hora do relógio (18h, 19h...): média das noites com movimento.
    chegadas_hora: dict[int, int] = defaultdict(int)
    for v in visitas:
        chegadas_hora[v.sentou_em.astimezone(FUSO).hour] += 1
    ocupacao_hora: dict[int, list[float]] = defaultdict(list)
    for hora, fracao in ocupacao.items():
        ocupacao_hora[hora.astimezone(FUSO).hour].append(fracao)
    dividir = max(noites, 1)
    por_hora = [
        PorHora(
            hora=h,
            chegadas=chegadas_hora[h] / dividir,
            ocupacao=sum(ocupacao_hora[h]) / dividir,
        )
        # Na ordem da noite: depois das 23h vem 0h, 1h...
        for h in sorted(
            set(chegadas_hora) | {h for h, f in ocupacao_hora.items() if sum(f) > 0},
            key=lambda h: (h - VIRADA.hour) % 24,
        )
    ]

    por_mesa = []
    for mesa in mesas:
        da_mesa = [v for v in visitas if v.mesa_numero == mesa.numero]
        servidas = [v for v in da_mesa if v.atendida]
        paradas_mesa = [p.total_seconds() for v in servidas if (p := v.parada()) is not None]
        esperas_mesa = [e.total_seconds() for v in servidas if (e := v.espera()) is not None]
        foram_embora = [v for v in da_mesa if v.sem_atendimento]
        por_mesa.append(
            PorMesa(
                numero=mesa.numero,
                lugares=mesa.lugares,
                visitas=len(servidas),
                desistencias=len(foram_embora),
                espera_media_seg=_media(esperas_mesa),
                parada_media_seg=_media(paradas_mesa),
                parada_total_seg=sum(paradas_mesa),
                perdido_centavos=valor_da_parada(excesso_por_mesa[mesa.numero])
                + sum(v.pessoas for v in foram_embora) * ticket_medio_centavos,
            )
        )

    return Indicadores(
        inicio=inicio,
        fim=fim,
        noites=noites,
        mesas_atendidas=len(atendidas),
        pessoas_atendidas=sum(v.pessoas for v in atendidas),
        desistencias=len(desistiram),
        pessoas_desistiram=sum(v.pessoas for v in desistiram),
        giro_medio=len(atendidas) / (len(mesas) * dividir) if mesas else 0.0,
        espera_media_seg=_media(esperas),
        esperas_acima_do_limite=sum(1 for e in esperas if e > limite_alerta.total_seconds()),
        permanencia_media_seg=permanencia_media,
        parada_media_seg=_media(paradas),
        parada_total_seg=sum(paradas),
        hora_pico=max(chegadas_hora, key=lambda h: chegadas_hora[h]) if chegadas_hora else None,
        ticket_medio_centavos=ticket_medio_centavos,
        perdido_desistencias_centavos=sum(v.pessoas for v in desistiram) * ticket_medio_centavos,
        perdido_mesa_parada_centavos=valor_da_parada(sum(excesso_por_mesa.values())),
        por_hora=por_hora,
        por_mesa=por_mesa,
    )
