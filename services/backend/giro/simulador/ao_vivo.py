"""Manda as observações de um cenário para a API em tempo real, como faria a câmera.

Com `inicio_em`, o cenário começa "no meio": o que já teria acontecido é enviado de uma vez
com a hora certa, e o resto segue no relógio. Útil para demonstração não começar parada.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from functools import partial

import httpx

from giro.simulador.cenario import INTERVALO, Cenario, mostrar_tempo

_mostrar = partial(print, flush=True)  # aparece na hora, mesmo com a saída redirecionada


def rodar_ao_vivo(
    cenario: Cenario,
    api: str,
    token: str,
    inicio_em: timedelta = timedelta(0),
    repetir: bool = False,
    dormir=time.sleep,
    relogio=lambda: datetime.now(UTC),
    saida=_mostrar,
    cliente: httpx.Client | None = None,
) -> None:
    cliente = cliente or httpx.Client(base_url=api)
    cliente.headers["authorization"] = f"Bearer {token}"
    with cliente:
        while True:
            _uma_rodada(cenario, cliente, inicio_em, dormir, relogio, saida)
            if not repetir:
                return
            saida("Recomeçando o cenário.")
            inicio_em = timedelta(0)


def _uma_rodada(cenario, cliente, inicio_em, dormir, relogio, saida) -> None:
    comeco = relogio() - inicio_em
    anterior: dict[int, tuple[int, int]] = {}
    acoes_avisadas: set[int] = set()
    t = timedelta(0)
    saida(f"Cenário '{cenario.nome}': {cenario.descricao}")
    while t <= cenario.duracao:
        espera = (comeco + t - relogio()).total_seconds()
        if espera > 0:
            dormir(espera)

        estado = cenario.estado_em(t)
        resposta = cliente.post(
            "/api/ingest/observacoes",
            json={
                "em": (comeco + t).isoformat(),
                "mesas": [
                    {"mesa": mesa, "sentados": sentados, "em_pe": em_pe}
                    for mesa, (sentados, em_pe) in estado.items()
                ],
            },
        )
        if resposta.status_code != 200:
            raise SystemExit(f"API recusou ({resposta.status_code}): {resposta.text}")
        if desconhecidas := resposta.json()["mesas_desconhecidas"]:
            saida(f"  Atenção: mesas sem cadastro no restaurante: {desconhecidas}")

        for mesa, (sentados, em_pe) in estado.items():
            if anterior.get(mesa) != (sentados, em_pe):
                descricao = f"{sentados} sentado(s)" + (f", {em_pe} em pé" if em_pe else "")
                saida(f"  {mostrar_tempo(t):>6}  mesa {mesa:>2}: {descricao}")
        anterior = estado

        for i, passo in enumerate(cenario.passos):
            if passo.acao and passo.em <= t and i not in acoes_avisadas:
                acoes_avisadas.add(i)
                saida(
                    f"  {mostrar_tempo(passo.em):>6}  mesa {passo.mesa:>2}: hora de a equipe "
                    f"tocar em '{passo.acao}' no painel"
                )
        t += INTERVALO
    saida("Cenário terminou.")
