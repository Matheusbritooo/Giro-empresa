"""Copiloto GIRO: briefing antes do turno e perguntas do dono. Só dono, gerente e admin GIRO."""

import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from giro.api.deps import GESTAO, Db, RestauranteAlvo, exigir_papel
from giro.banco import agora
from giro.modelos import Restaurante
from giro.servicos import copiloto

router = APIRouter(prefix="/api/copiloto", tags=["copiloto"], dependencies=[exigir_papel(*GESTAO)])

# Cada pergunta com a IA ligada custa uma chamada: um teto por restaurante evita surpresa na conta.
PERGUNTAS_POR_HORA = 60


class LimitePerguntas:
    def __init__(self) -> None:
        self._feitas: dict[int, deque[float]] = defaultdict(deque)

    def permitir(self, restaurante_id: int) -> bool:
        agora_s = time.monotonic()
        feitas = self._feitas[restaurante_id]
        while feitas and agora_s - feitas[0] > 3600:
            feitas.popleft()
        if len(feitas) >= PERGUNTAS_POR_HORA:
            return False
        feitas.append(agora_s)
        return True


class BriefingSaida(BaseModel):
    dia: str
    dia_semana: str
    frases: list[str]
    dicas: list[str]
    ia_ligada: bool


class PerguntaEntrada(BaseModel):
    pergunta: str = Field(min_length=3, max_length=300)


class RespostaSaida(BaseModel):
    resposta: str
    fonte: str  # "ia" (Claude) ou "regras" (respostas prontas)


def _restaurante(db, restaurante_id: int) -> Restaurante:
    restaurante = db.get(Restaurante, restaurante_id)
    if restaurante is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "restaurante não encontrado")
    return restaurante


@router.get("/briefing")
def ver_briefing(request: Request, db: Db, restaurante_id: RestauranteAlvo) -> BriefingSaida:
    ctx = copiloto.montar_contexto(db, _restaurante(db, restaurante_id), agora())
    recado = copiloto.briefing(ctx)
    return BriefingSaida(
        dia=recado.dia.isoformat(),
        dia_semana=recado.dia_semana,
        frases=recado.frases,
        dicas=recado.dicas,
        ia_ligada=request.app.state.copiloto.ia_ligada,
    )


@router.post("/perguntar")
def perguntar(
    dados: PerguntaEntrada, request: Request, db: Db, restaurante_id: RestauranteAlvo
) -> RespostaSaida:
    if not request.app.state.limite_copiloto.permitir(restaurante_id):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Muitas perguntas nesta hora. Tente de novo daqui a pouco.",
        )
    ctx = copiloto.montar_contexto(db, _restaurante(db, restaurante_id), agora())
    resposta, fonte = request.app.state.copiloto.responder(dados.pergunta.strip(), ctx)
    return RespostaSaida(resposta=resposta, fonte=fonte)
