"""Resultados do salão, replay da noite e simulador "E se?". Só dono, gerente e admin GIRO."""

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from giro.api.deps import GESTAO, Db, RestauranteAlvo, exigir_papel
from giro.banco import agora
from giro.dominio.cenarios import Cenario, simular
from giro.dominio.indicadores import intervalo_da_noite, noite_de
from giro.esquemas import (
    CenarioSaida,
    MesaReplay,
    ReplaySaida,
    ResultadosSaida,
    VisitaReplay,
)
from giro.modelos import Restaurante
from giro.servicos import resultados as servico
from giro.servicos.resultados import Periodo

router = APIRouter(
    prefix="/api/resultados", tags=["resultados"], dependencies=[exigir_papel(*GESTAO)]
)

DiaConsulta = Annotated[date | None, Query(description="noite (AAAA-MM-DD); padrão: a de agora")]


def _restaurante(db, restaurante_id: int) -> Restaurante:
    restaurante = db.get(Restaurante, restaurante_id)
    if restaurante is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "restaurante não encontrado")
    return restaurante


@router.get("")
def ver_resultados(
    db: Db,
    restaurante_id: RestauranteAlvo,
    periodo: Periodo = Periodo.NOITE,
    dia: DiaConsulta = None,
) -> ResultadosSaida:
    momento = agora()
    resultado = servico.resultados(
        db, _restaurante(db, restaurante_id), periodo, dia or noite_de(momento), momento
    )
    return ResultadosSaida.model_validate(resultado)


@router.get("/replay")
def ver_replay(db: Db, restaurante_id: RestauranteAlvo, dia: DiaConsulta = None) -> ReplaySaida:
    """As visitas de uma noite, para o painel refazer o salão minuto a minuto."""
    restaurante = _restaurante(db, restaurante_id)
    momento = agora()
    noite = dia or noite_de(momento)
    inicio, fim = intervalo_da_noite(noite)
    mesas = servico.carregar_mesas(db, restaurante.id)
    ocupacoes = servico.carregar_ocupacoes(db, restaurante.id, inicio, min(fim, momento))
    ativas = {m.id for m in mesas}
    return ReplaySaida(
        dia=noite,
        inicio=inicio,
        fim=min(fim, momento),
        limite_alerta_seg=restaurante.alerta_atendimento_seg,
        mesas=[MesaReplay.model_validate(m) for m in mesas],
        visitas=[VisitaReplay.model_validate(o) for o in ocupacoes if o.mesa_id in ativas],
    )


@router.get("/e-se")
def simular_cenario(
    db: Db,
    restaurante_id: RestauranteAlvo,
    periodo: Periodo = Periodo.SEMANA,
    dia: DiaConsulta = None,
    limpeza_max_min: Annotated[float | None, Query(ge=0.5, le=60)] = None,
    garcons_atual: Annotated[int | None, Query(ge=1, le=50)] = None,
    garcons_novo: Annotated[int | None, Query(ge=1, le=50)] = None,
) -> CenarioSaida:
    """Quanto o restaurante ganharia limpando mais rápido ou com outra equipe."""
    restaurante = _restaurante(db, restaurante_id)
    momento = agora()
    inicio, fim = servico.intervalo(periodo, dia or noite_de(momento))
    dados = servico.carregar(db, restaurante, inicio, fim, momento)
    cenario = Cenario(
        limpeza_max=timedelta(minutes=limpeza_max_min) if limpeza_max_min else None,
        garcons_atual=garcons_atual,
        garcons_novo=garcons_novo,
    )
    resultado = simular(
        dados.visitas,
        dados.mesas_info,
        dados.inicio,
        dados.fim,
        cenario,
        ticket_medio_centavos=restaurante.ticket_medio_centavos,
    )
    return CenarioSaida.model_validate(resultado)
