"""Liga a comparação da semana (giro/dominio/semana.py) ao banco: a tela Hoje mostra, e o
aviso "O Copiloto notou" sai no celular uma vez por semana (giro/servicos/turno.py)."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from giro.dominio.indicadores import intervalo_da_noite, noite_de
from giro.dominio.semana import Mudanca, mudancas_da_semana
from giro.modelos import Restaurante
from giro.servicos import resultados


def chave_da_semana(dia: date) -> str:
    """A segunda-feira da semana (AAAA-MM-DD): o aviso sai uma vez por chave."""
    return (dia - timedelta(days=dia.weekday())).isoformat()


def semana_que_passou(db: Session, restaurante: Restaurante, agora: datetime) -> list[Mudanca]:
    """As 7 últimas noites fechadas (até ontem) contra as 7 anteriores."""
    fim, _ = intervalo_da_noite(noite_de(agora))  # a noite de hoje ainda não conta
    meio, inicio = fim - timedelta(days=7), fim - timedelta(days=14)
    dados = resultados.carregar(db, restaurante, inicio, fim, agora)
    return mudancas_da_semana(
        dados.indicadores(meio, fim),
        dados.indicadores(inicio, meio),
        resultados.notas_do_periodo(db, restaurante, meio, fim),
        resultados.notas_do_periodo(db, restaurante, inicio, meio),
    )
