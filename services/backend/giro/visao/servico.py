"""Serviço de visão: recebe a foto da câmera, conta pessoas por mesa e manda só os números à API.

Rodar: uv run --extra visao uvicorn --factory giro.visao.servico:criar_app --port 8001

Caminho de uma foto:
  conector/DVR ── POST /visao/quadros (token da câmera) ──► confere o token na API (com cache)
     ► acha as pessoas ► decide sentado/em pé por mesa ► POST /api/ingest/observacoes
     ► guarda na memória só uma prévia pixelada, por poucos minutos ► descarta a foto

As rotas /interno/* servem a prévia para a API e exigem o segredo compartilhado. Em produção
o Caddy só deixa chegar de fora o que começa com /visao.
"""

from __future__ import annotations

import hmac
import logging
import os
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from typing import Annotated, Any, Protocol

import httpx
from fastapi import FastAPI, Header, HTTPException, Request, Response, status
from PIL import Image, UnidentifiedImageError
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.concurrency import run_in_threadpool

from giro.seguranca import hash_token
from giro.visao.detector import Pessoa
from giro.visao.leitura import Ajustes, ZonaMesa, ler
from giro.visao.privacidade import previa_sem_rostos

log = logging.getLogger("giro.visao")

# Foto grande demais pode ser ataque ("bomba de descompressão"). 4000 x 4000 já sobra.
Image.MAX_IMAGE_PIXELS = 16_000_000


class ConfigVisao(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GIRO_VISAO_", env_file=".env", extra="ignore")

    api_url: str = "http://localhost:8000"
    segredo: str | None = None  # mesmo valor de GIRO_VISAO_SEGREDO na API
    modelo: str = "yolox_s"
    threads: int | None = None
    simultaneos: int = max(1, (os.cpu_count() or 2) // 2)  # fotos analisadas ao mesmo tempo
    tamanho_max_mb: float = 4
    previa_minutos: float = 3
    cache_config_seg: float = 10  # desenho novo de mesa vale em até ~20 s


class Detector(Protocol):
    """O que o serviço precisa de um detector. Nos testes entra um falso, sem modelo."""

    def detectar(self, imagem: Image.Image, limiar: float = 0.35) -> list[Pessoa]: ...


@dataclass
class _Previa:
    jpeg: bytes
    leitura: dict[str, Any]
    validade: float


class _Memoria:
    """Prévias e configurações em memória, com prazo. Nada vai para disco."""

    def __init__(self) -> None:
        self._trava = threading.Lock()
        self._previas: dict[int, _Previa] = {}
        self._configs: dict[str, tuple[float, dict[str, Any] | None]] = {}

    def guardar_previa(self, camera_id: int, previa: _Previa) -> None:
        with self._trava:
            agora = time.monotonic()
            self._previas = {c: p for c, p in self._previas.items() if p.validade > agora}
            self._previas[camera_id] = previa

    def previa(self, camera_id: int) -> _Previa | None:
        with self._trava:
            previa = self._previas.get(camera_id)
            return previa if previa and previa.validade > time.monotonic() else None

    def config(self, chave: str) -> tuple[bool, dict[str, Any] | None]:
        with self._trava:
            item = self._configs.get(chave)
            if item and item[0] > time.monotonic():
                return True, item[1]
            return False, None

    def guardar_config(self, chave: str, config: dict[str, Any] | None, segundos: float) -> None:
        with self._trava:
            self._configs[chave] = (time.monotonic() + segundos, config)


def criar_app(
    config: ConfigVisao | None = None,
    detector: Detector | None = None,
    cliente_api: httpx.Client | None = None,
) -> FastAPI:
    config = config or ConfigVisao()
    if detector is None:
        from giro.visao.detector import DetectorYolox
        from giro.visao.modelo import MODELOS, garantir_modelo

        modelo = MODELOS[config.modelo]
        detector = DetectorYolox(garantir_modelo(modelo.nome), modelo.tamanho, config.threads)
    api = cliente_api or httpx.Client(base_url=config.api_url, timeout=10)
    memoria = _Memoria()
    vagas = threading.BoundedSemaphore(config.simultaneos)
    limite_bytes = int(config.tamanho_max_mb * 1024 * 1024)

    app = FastAPI(title="GIRO Visão", docs_url=None, redoc_url=None, openapi_url=None)

    def configuracao_da_camera(token: str) -> dict[str, Any]:
        chave = hash_token(token)
        achou, dados = memoria.config(chave)
        if not achou:
            resposta = api.get(
                "/api/ingest/configuracao", headers={"authorization": f"Bearer {token}"}
            )
            dados = resposta.json() if resposta.status_code == 200 else None
            if resposta.status_code not in (200, 401):
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, "API indisponível")
            # Token inválido também fica no cache, para ninguém martelar a API com chute.
            memoria.guardar_config(chave, dados, config.cache_config_seg)
        if dados is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token de câmera inválido")
        return dados

    @app.get("/visao/saude")
    def saude() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/visao/quadros")
    async def receber_quadro(
        request: Request,
        authorization: Annotated[str, Header()] = "",
        x_giro_em: Annotated[datetime | None, Header()] = None,
    ) -> dict[str, Any]:
        token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
        if not token.startswith("cam_"):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token de câmera inválido")
        tamanho = int(request.headers.get("content-length") or 0)
        if tamanho > limite_bytes:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "foto grande demais")
        corpo = await request.body()
        if len(corpo) > limite_bytes:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "foto grande demais")
        em = x_giro_em or datetime.now(UTC)
        if em.tzinfo is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "X-Giro-Em sem fuso")
        return await run_in_threadpool(processar, token, corpo, em)

    def processar(token: str, corpo: bytes, em: datetime) -> dict[str, Any]:
        camera = configuracao_da_camera(token)
        if not vagas.acquire(timeout=5):
            # Serviço ocupado: a foto se perde, a próxima chega em 10 s. Melhor que fila infinita.
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "ocupado, tente a próxima")
        try:
            try:
                imagem = Image.open(BytesIO(corpo))
                imagem.load()
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as erro:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "arquivo não é uma foto"
                ) from erro
            ajustes = Ajustes.de_dict(camera["ajustes"])
            pessoas = detector.detectar(imagem, limiar=ajustes.confianca_minima)
            zonas = [
                ZonaMesa(m["numero"], [tuple(p) for p in m["poligono"]]) for m in camera["mesas"]
            ]
            leitura = ler(pessoas, zonas, ajustes)
            previa = previa_sem_rostos(imagem, pessoas)
        finally:
            vagas.release()
        # Daqui para frente só existem números e a prévia pixelada; a foto original morre aqui.

        resposta = api.post(
            "/api/ingest/observacoes",
            headers={"authorization": f"Bearer {token}"},
            json={"em": em.isoformat(), "mesas": leitura.observacoes()},
        )
        if resposta.status_code != 200:
            log.warning("API recusou observações (status %s)", resposta.status_code)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "API recusou as observações")

        resumo = {
            "em": em.isoformat(),
            "pessoas": [
                {
                    "x1": p.pessoa.x1,
                    "y1": p.pessoa.y1,
                    "x2": p.pessoa.x2,
                    "y2": p.pessoa.y2,
                    "em_pe": p.em_pe,
                    "mesa": p.mesa,
                }
                for p in leitura.pessoas
            ],
            "mesas": leitura.observacoes(),
        }
        memoria.guardar_previa(
            camera["camera_id"],
            _Previa(previa, resumo, time.monotonic() + config.previa_minutos * 60),
        )
        return {"pessoas": len(leitura.pessoas), "mesas": resumo["mesas"]}

    def _interno(segredo: str) -> None:
        if not config.segredo or not hmac.compare_digest(segredo, config.segredo):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "acesso interno negado")

    @app.get("/interno/cameras/{camera_id}/previa")
    def previa(camera_id: int, x_giro_interno: Annotated[str, Header()] = "") -> Response:
        _interno(x_giro_interno)
        guardada = memoria.previa(camera_id)
        if guardada is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "sem imagem recente")
        return Response(guardada.jpeg, media_type="image/jpeg")

    @app.get("/interno/cameras/{camera_id}/leitura")
    def leitura(camera_id: int, x_giro_interno: Annotated[str, Header()] = "") -> dict[str, Any]:
        _interno(x_giro_interno)
        guardada = memoria.previa(camera_id)
        if guardada is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "sem imagem recente")
        return guardada.leitura

    return app
