"""Monta a API. Para rodar: uv run uvicorn --factory giro.api.app:criar_app --reload"""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import sessionmaker
from starlette.concurrency import run_in_threadpool

from giro.api.cliente_visao import ClienteVisao
from giro.api.rotas import (
    ao_vivo,
    auth,
    cameras,
    equipe,
    ingest,
    mesas,
    push,
    resultados,
    salao,
)
from giro.api.rotas.auth import LimiteTentativas
from giro.banco import agora, criar_engine, criar_sessoes
from giro.config import Config, obter_config
from giro.push import EnviadorPush
from giro.servicos.salao import ServicoSalao
from giro.tempo_real import CentralTempoReal

log = logging.getLogger("giro")


def criar_app(config: Config | None = None) -> FastAPI:
    config = config or obter_config()
    config.validar_producao()
    engine = criar_engine(config.database_url)
    sessoes = criar_sessoes(engine)
    central = CentralTempoReal()
    enviador_push = EnviadorPush(config, sessoes)
    servico = ServicoSalao(central, enviador_push)

    @asynccontextmanager
    async def ciclo_de_vida(_app: FastAPI):
        central.loop = asyncio.get_running_loop()
        verificador = None
        if config.verificador_intervalo_seg > 0:
            verificador = asyncio.create_task(
                _verificar_periodicamente(sessoes, servico, config.verificador_intervalo_seg)
            )
        yield
        if verificador:
            verificador.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await verificador
        enviador_push.encerrar()
        app.state.visao.fechar()
        engine.dispose()

    app = FastAPI(
        title="GIRO API",
        description="Inteligência de salão para restaurantes de bairro.",
        version="0.1.0",
        lifespan=ciclo_de_vida,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.config = config
    app.state.sessoes = sessoes
    app.state.central = central
    app.state.servico = servico
    app.state.limite_login = LimiteTentativas()
    app.state.visao = ClienteVisao(config)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.origens_cors,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["content-type", "authorization"],
    )
    for modulo in (auth, salao, mesas, equipe, cameras, ingest, push, ao_vivo, resultados):
        app.include_router(modulo.router)

    @app.get("/api/saude", tags=["saúde"])
    def saude() -> dict[str, bool]:
        return {"ok": True}

    return app


async def _verificar_periodicamente(
    sessoes: sessionmaker, servico: ServicoSalao, intervalo: float
) -> None:
    def verificar() -> None:
        with sessoes() as db:
            servico.verificar_tempos(db, agora())

    while True:
        await asyncio.sleep(intervalo)
        try:
            await run_in_threadpool(verificar)
        except Exception:
            log.exception("falha ao verificar alertas por tempo")
