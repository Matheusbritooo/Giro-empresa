"""Simulador "E se?": quanto o restaurante ganharia mudando o jeito de trabalhar.

Refaz as visitas reais de um período com outra regra e compara com o que aconteceu:
- "E se a mesa fosse limpa em até X minutos?": a mesa parada além disso, nas horas de salão
  cheio, vira turmas que poderiam ter sentado.
- "E se tivesse N garçons em vez de M?": a espera até o atendimento muda na mesma proporção.
  Quem foi embora sem atendimento depois de esperar mais do que a nova espera média teria sido
  atendido; com menos gente, quem esperou mais do que a paciência típica vai embora.

É estimativa, não promessa: usa só o que a câmera viu e o ticket médio que o dono informou.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median

from giro.dominio.indicadores import (
    MesaInfo,
    Visita,
    horas_cheias,
    ocupacao_por_hora,
    parada_em_horas_cheias,
)

# Sem nenhuma desistência no histórico, a paciência típica de quem espera atendimento.
PACIENCIA_PADRAO = timedelta(minutes=12)


@dataclass(frozen=True)
class Cenario:
    limpeza_max: timedelta | None = None  # mesa limpa em até isso depois que o cliente sai
    garcons_atual: int | None = None
    garcons_novo: int | None = None


@dataclass
class ResultadoCenario:
    turmas_a_mais: float  # turmas que caberiam nas mesas com a limpeza mais rápida
    desistencias_evitadas: int
    desistencias_novas: int  # só com menos garçons
    espera_media_atual_seg: float | None
    espera_media_nova_seg: float | None
    parada_media_atual_seg: float | None
    parada_media_nova_seg: float | None
    ganho_centavos: int  # no período (negativo = perda)
    ganho_mes_centavos: int  # o mesmo ritmo por 30 dias


def _media(valores: list[float]) -> float | None:
    return sum(valores) / len(valores) if valores else None


def simular(
    visitas: list[Visita],
    mesas: list[MesaInfo],
    inicio: datetime,
    fim: datetime,
    cenario: Cenario,
    *,
    ticket_medio_centavos: int,
) -> ResultadoCenario:
    visitas = [v for v in visitas if inicio <= v.sentou_em < fim]
    atendidas = [v for v in visitas if v.atendida]
    desistiram = [v for v in visitas if v.sem_atendimento]
    pessoas_por_turma = _media([float(v.pessoas) for v in atendidas]) or 0.0
    permanencia = _media(
        [(v.saiu_em - v.sentou_em).total_seconds() for v in atendidas if v.saiu_em is not None]
    )

    # Limpeza mais rápida: a mesa parada além do novo limite, em hora cheia, vira turmas novas.
    paradas = [p.total_seconds() for v in atendidas if (p := v.parada()) is not None]
    parada_nova = paradas
    turmas_a_mais = 0.0
    if cenario.limpeza_max is not None:
        limite = cenario.limpeza_max.total_seconds()
        parada_nova = [min(p, limite) for p in paradas]
        cheias = horas_cheias(ocupacao_por_hora(visitas, len(mesas), inicio, fim))
        recuperado = sum(parada_em_horas_cheias(v, cenario.limpeza_max, cheias) for v in atendidas)
        if permanencia:
            turmas_a_mais = recuperado / permanencia

    # Garçons: a espera muda na proporção da equipe.
    esperas = [e.total_seconds() for v in atendidas if (e := v.espera()) is not None]
    espera_nova = esperas
    evitadas: list[Visita] = []
    novas: list[Visita] = []
    atual, novo = cenario.garcons_atual, cenario.garcons_novo
    if atual and novo and atual != novo:
        fator = atual / novo
        espera_nova = [e * fator for e in esperas]
        media_nova = _media(espera_nova) or 0.0
        if novo > atual:
            evitadas = [
                v
                for v in desistiram
                if v.saiu_em is not None and (v.saiu_em - v.sentou_em).total_seconds() > media_nova
            ]
        else:
            esperas_de_quem_foi = [
                (v.saiu_em - v.sentou_em).total_seconds() for v in desistiram if v.saiu_em
            ]
            paciencia = (
                median(esperas_de_quem_foi)
                if esperas_de_quem_foi
                else PACIENCIA_PADRAO.total_seconds()
            )
            novas = [
                v
                for v in atendidas
                if (e := v.espera()) is not None and e.total_seconds() * fator > paciencia
            ]

    ganho = round(turmas_a_mais * pessoas_por_turma * ticket_medio_centavos)
    ganho += sum(v.pessoas for v in evitadas) * ticket_medio_centavos
    ganho -= sum(v.pessoas for v in novas) * ticket_medio_centavos
    dias = max((fim - inicio).total_seconds() / 86400, 1.0)

    return ResultadoCenario(
        turmas_a_mais=turmas_a_mais,
        desistencias_evitadas=len(evitadas),
        desistencias_novas=len(novas),
        espera_media_atual_seg=_media(esperas),
        espera_media_nova_seg=_media(espera_nova),
        parada_media_atual_seg=_media(paradas),
        parada_media_nova_seg=_media(parada_nova),
        ganho_centavos=ganho,
        ganho_mes_centavos=round(ganho * 30 / dias),
    )
