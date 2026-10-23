"""Avisos do turno no celular do dono e do gerente: briefing na abertura, resumo no fechamento.

Roda junto da verificação periódica de alertas. Cada aviso sai uma vez por noite (o
restaurante guarda a última noite avisada) e só se o push estiver configurado.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.dominio.indicadores import FUSO, VIRADA, Indicadores, intervalo_da_noite, noite_de
from giro.modelos import Papel, Restaurante
from giro.push import EnviadorPush
from giro.servicos import copiloto, resultados

# Passou disso depois da abertura sem o servidor estar no ar, o briefing já não serve.
JANELA_BRIEFING = timedelta(hours=2)
GESTAO = (Papel.DONO, Papel.GERENTE)


def momento_na_noite(noite: date, horario: str) -> datetime:
    """ "23:30" da noite de sexta é sexta 23h30; "00:30" é sábado 0h30 (a noite vai até as 6h)."""
    hora = time.fromisoformat(horario)
    dia = noite + timedelta(days=1) if hora < VIRADA else noite
    return datetime.combine(dia, hora, FUSO)


def _reais(centavos: int) -> str:
    return f"R$ {centavos / 100:,.0f}".replace(",", ".")


def texto_do_resumo(r: Indicadores) -> str:
    """O resumo da noite em poucas frases, para caber na notificação."""
    mesas = "1 mesa atendida" if r.mesas_atendidas == 1 else f"{r.mesas_atendidas} mesas atendidas"
    giro = f"{r.giro_medio:.1f}".replace(".", ",")
    partes = [f"{mesas}, giro de {giro} por mesa."]
    if r.desistencias:
        foram = "1 mesa foi" if r.desistencias == 1 else f"{r.desistencias} mesas foram"
        partes.append(f"{foram} embora sem atendimento.")
    if r.perdido_total_centavos:
        partes.append(f"Cerca de {_reais(r.perdido_total_centavos)} ficaram na mesa.")
    pior = max(
        (m for m in r.por_mesa if m.parada_media_seg),
        key=lambda m: m.parada_media_seg or 0,
        default=None,
    )
    if pior and pior.parada_media_seg and pior.parada_media_seg >= 8 * 60:
        partes.append(f"Mesa {pior.numero}: {pior.parada_media_seg / 60:.0f} min parada em média.")
    return " ".join(partes)


def verificar_avisos(db: Session, push: EnviadorPush, agora: datetime) -> None:
    if not push.ativo:
        return
    noite = noite_de(agora)
    chave = noite.isoformat()
    inicio, fim = intervalo_da_noite(noite)
    for restaurante in db.scalars(select(Restaurante)):
        abre = momento_na_noite(noite, restaurante.abre_as)
        fecha = momento_na_noite(noite, restaurante.fecha_as)

        if restaurante.ultimo_briefing_noite != chave and abre <= agora < abre + JANELA_BRIEFING:
            recado = copiloto.briefing(copiloto.montar_contexto(db, restaurante, agora))
            push.enviar(
                restaurante.id, "Antes do turno", recado.resumo_curto, GESTAO, url="/resultados"
            )
            restaurante.ultimo_briefing_noite = chave

        if restaurante.ultimo_resumo_noite != chave and fecha <= agora < fim:
            dados = resultados.carregar(db, restaurante, inicio, fim, agora)
            noite_ate_agora = dados.indicadores(inicio, agora)
            if noite_ate_agora.mesas_atendidas or noite_ate_agora.desistencias:
                push.enviar(
                    restaurante.id,
                    "Resumo da noite",
                    texto_do_resumo(noite_ate_agora),
                    GESTAO,
                    url="/resultados",
                )
            restaurante.ultimo_resumo_noite = chave
    db.commit()
