"""Conversa da API com o serviço de visão, por um canal interno protegido por segredo."""

from __future__ import annotations

from typing import Any

import httpx

from giro.config import Config

CABECALHO_INTERNO = "x-giro-interno"


class VisaoIndisponivel(Exception):
    pass


class ClienteVisao:
    def __init__(self, config: Config, cliente: httpx.Client | None = None) -> None:
        """`cliente` serve para os testes ligarem a API direto num serviço de visão de teste."""
        if cliente is None and config.visao_url and config.visao_segredo:
            cliente = httpx.Client(base_url=config.visao_url, timeout=5)
        self._cliente = cliente
        self._cabecalhos = {CABECALHO_INTERNO: config.visao_segredo or ""}

    def _pegar(self, caminho: str) -> httpx.Response | None:
        if self._cliente is None:
            raise VisaoIndisponivel("serviço de visão não configurado neste servidor")
        try:
            resposta = self._cliente.get(caminho, headers=self._cabecalhos)
        except httpx.HTTPError as erro:
            raise VisaoIndisponivel("serviço de visão fora do ar") from erro
        if resposta.status_code == 404:
            return None
        if resposta.status_code != 200:
            raise VisaoIndisponivel(f"serviço de visão respondeu {resposta.status_code}")
        return resposta

    def previa(self, camera_id: int) -> bytes | None:
        resposta = self._pegar(f"/interno/cameras/{camera_id}/previa")
        return resposta.content if resposta else None

    def leitura(self, camera_id: int) -> dict[str, Any] | None:
        resposta = self._pegar(f"/interno/cameras/{camera_id}/leitura")
        return resposta.json() if resposta else None

    def fechar(self) -> None:
        if self._cliente is not None:
            self._cliente.close()
