"""Entrega ao vivo para os painéis abertos, separada por restaurante.

Cada painel conectado tem uma fila. Quem muda alguma coisa no salão chama `publicar` (de
qualquer thread) e a mensagem entra na fila de cada painel daquele restaurante.
"""

import asyncio
from collections import defaultdict
from typing import Any

Mensagem = dict[str, Any] | None  # None avisa que a conexão acabou


class CentralTempoReal:
    def __init__(self) -> None:
        self._filas: dict[int, set[asyncio.Queue[Mensagem]]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None

    def inscrever(self, restaurante_id: int) -> asyncio.Queue[Mensagem]:
        fila: asyncio.Queue[Mensagem] = asyncio.Queue()
        self._filas[restaurante_id].add(fila)
        return fila

    def cancelar(self, restaurante_id: int, fila: asyncio.Queue[Mensagem]) -> None:
        self._filas[restaurante_id].discard(fila)

    def publicar(self, restaurante_id: int, mensagem: dict[str, Any]) -> None:
        if self.loop is not None and self._filas.get(restaurante_id):
            self.loop.call_soon_threadsafe(self._distribuir, restaurante_id, mensagem)

    def _distribuir(self, restaurante_id: int, mensagem: dict[str, Any]) -> None:
        for fila in self._filas.get(restaurante_id, ()):
            fila.put_nowait(mensagem)
