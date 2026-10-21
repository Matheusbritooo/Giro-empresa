"""Canal ao vivo do painel: manda o salão inteiro ao conectar e depois cada mudança."""

import asyncio
import contextlib

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from starlette.concurrency import run_in_threadpool

from giro.api.deps import COOKIE_SESSAO, restaurante_permitido, usuario_do_token
from giro.api.rotas.salao import montar_salao
from giro.tempo_real import CentralTempoReal, Mensagem

router = APIRouter(tags=["salão"])


def _restaurante_da_sessao(app, token: str | None, pedido: int | None) -> int | None:
    with app.state.sessoes() as db:
        usuario = usuario_do_token(db, app.state.config, token)
        if usuario is None:
            return None
        try:
            return restaurante_permitido(usuario, pedido)
        except HTTPException:
            return None


def _salao(app, restaurante_id: int) -> dict:
    with app.state.sessoes() as db:
        return montar_salao(db, restaurante_id).model_dump(mode="json")


@router.websocket("/api/ao-vivo")
async def ao_vivo(websocket: WebSocket, restaurante_id: int | None = None) -> None:
    app = websocket.app
    # O navegador manda o cookie de sessão em qualquer WebSocket, inclusive aberto por outro
    # site. Por isso só aceitamos conexões vindas do próprio painel.
    origem = websocket.headers.get("origin")
    if origem is not None and origem not in app.state.config.origens_cors:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    restaurante = await run_in_threadpool(
        _restaurante_da_sessao, app, websocket.cookies.get(COOKIE_SESSAO), restaurante_id
    )
    if restaurante is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    central: CentralTempoReal = app.state.central
    # Inscreve antes de ler o salão: o que mudar enquanto lemos fica na fila e vai depois.
    fila = central.inscrever(restaurante)
    escuta = asyncio.create_task(_escutar(websocket, fila))
    try:
        salao = await run_in_threadpool(_salao, app, restaurante)
        await websocket.send_json({"tipo": "salao", "salao": salao})
        while (mensagem := await fila.get()) is not None:
            await websocket.send_json(mensagem)
    except (WebSocketDisconnect, RuntimeError):
        pass  # painel fechou no meio de um envio
    finally:
        central.cancelar(restaurante, fila)
        escuta.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await escuta


async def _escutar(websocket: WebSocket, fila: "asyncio.Queue[Mensagem]") -> None:
    """O painel manda "ping" de tempos em tempos. Quando a conexão cai, avisa a fila."""
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        fila.put_nowait(None)
