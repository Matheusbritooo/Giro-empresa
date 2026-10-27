"""Liga os indicadores ao banco: busca as visitas de um período e monta o que a tela mostra."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.dominio.indicadores import (
    Indicadores,
    MesaInfo,
    Visita,
    calcular,
    intervalo_da_noite,
)
from giro.modelos import Mesa, Ocupacao, Restaurante


class Periodo(StrEnum):
    NOITE = "noite"
    SEMANA = "semana"
    MES = "mes"


# O "mês" tem 4 semanas: assim cada dia da semana aparece o mesmo número de vezes.
NOITES = {Periodo.NOITE: 1, Periodo.SEMANA: 7, Periodo.MES: 28}


def intervalo(periodo: Periodo, dia: date) -> tuple[datetime, datetime]:
    """O período que termina na noite `dia` (inclusive)."""
    _, fim = intervalo_da_noite(dia)
    return fim - timedelta(days=NOITES[periodo]), fim


def anterior(periodo: Periodo, dia: date) -> date:
    """O dia que fecha o período de comparação: a mesma noite da semana passada, ou o período
    de mesmo tamanho logo antes."""
    return dia - timedelta(days=7 if periodo == Periodo.NOITE else NOITES[periodo])


def carregar_mesas(db: Session, restaurante_id: int) -> list[Mesa]:
    return list(
        db.scalars(
            select(Mesa)
            .where(Mesa.restaurante_id == restaurante_id, Mesa.ativa.is_(True))
            .order_by(Mesa.numero)
        )
    )


def carregar_ocupacoes(
    db: Session, restaurante_id: int, inicio: datetime, fim: datetime
) -> list[Ocupacao]:
    return list(
        db.scalars(
            select(Ocupacao)
            .where(
                Ocupacao.restaurante_id == restaurante_id,
                Ocupacao.sentou_em >= inicio,
                Ocupacao.sentou_em < fim,
            )
            .order_by(Ocupacao.sentou_em)
        )
    )


def para_visitas(ocupacoes: list[Ocupacao], mesas: list[Mesa]) -> list[Visita]:
    numero = {m.id: m.numero for m in mesas}
    return [
        Visita(
            mesa_numero=numero[o.mesa_id],
            sentou_em=o.sentou_em,
            atendida_em=o.atendida_em,
            saiu_em=o.saiu_em,
            liberada_em=o.liberada_em,
            pessoas=o.pessoas,
            sem_atendimento=o.sem_atendimento,
        )
        for o in ocupacoes
        if o.mesa_id in numero  # mesa desativada sai dos resultados
    ]


@dataclass
class Dados:
    """Visitas e mesas de um restaurante num intervalo, já no formato do domínio."""

    restaurante: Restaurante
    mesas: list[Mesa]
    visitas: list[Visita]
    inicio: datetime
    fim: datetime

    @property
    def mesas_info(self) -> list[MesaInfo]:
        return [MesaInfo(m.numero, m.lugares) for m in self.mesas]

    def indicadores(self, inicio: datetime, fim: datetime) -> Indicadores:
        return calcular(
            self.visitas,
            self.mesas_info,
            inicio,
            fim,
            ticket_medio_centavos=self.restaurante.ticket_medio_centavos,
            limite_alerta=timedelta(seconds=self.restaurante.alerta_atendimento_seg),
        )


def carregar(
    db: Session, restaurante: Restaurante, inicio: datetime, fim: datetime, agora: datetime
) -> Dados:
    """Tudo o que os indicadores precisam. O intervalo nunca passa de agora: a noite em curso
    conta só até este instante."""
    fim = min(fim, agora)
    mesas = carregar_mesas(db, restaurante.id)
    ocupacoes = carregar_ocupacoes(db, restaurante.id, inicio, fim)
    return Dados(restaurante, mesas, para_visitas(ocupacoes, mesas), inicio, fim)


@dataclass
class ResumoNoite:
    dia: date
    mesas_atendidas: int
    giro_medio: float
    desistencias: int
    perdido_total_centavos: int


@dataclass
class Resultados:
    periodo: Periodo
    dia: date
    atual: Indicadores
    anterior: Indicadores
    noites: list[ResumoNoite]


def resultados(
    db: Session, restaurante: Restaurante, periodo: Periodo, dia: date, agora: datetime
) -> Resultados:
    inicio, fim = intervalo(periodo, dia)
    inicio_antes, fim_antes = intervalo(periodo, anterior(periodo, dia))
    dados = carregar(db, restaurante, min(inicio, inicio_antes), fim, agora)
    atual = dados.indicadores(inicio, min(fim, agora))
    antes = dados.indicadores(inicio_antes, min(fim_antes, agora))

    noites = []
    if periodo != Periodo.NOITE:
        for i in range(NOITES[periodo]):
            noite = dia - timedelta(days=NOITES[periodo] - 1 - i)
            de, ate = intervalo_da_noite(noite)
            r = dados.indicadores(de, min(ate, agora))
            noites.append(
                ResumoNoite(
                    noite, r.mesas_atendidas, r.giro_medio, r.desistencias, r.perdido_total_centavos
                )
            )
    return Resultados(periodo, dia, atual, antes, noites)
