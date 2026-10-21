"""Porta de entrada do que a câmera viu.

Hoje quem chama é o simulador. Na Fase 2 será o worker de visão, com o mesmo formato:
a foto é analisada e descartada antes de chegar aqui. Esta rota nunca recebe imagem.
"""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from giro.api.deps import CameraAutenticada, Db, Servico
from giro.banco import agora
from giro.esquemas import ObservacoesEntrada

router = APIRouter(prefix="/api/ingest", tags=["câmera"])

TOLERANCIA_FUTURO = timedelta(seconds=60)
LIMITE_PASSADO = timedelta(hours=24)


class ResultadoIngest(BaseModel):
    processadas: int
    mesas_desconhecidas: list[int]


@router.post("/observacoes")
def receber_observacoes(
    dados: ObservacoesEntrada, camera: CameraAutenticada, db: Db, servico: Servico
) -> ResultadoIngest:
    momento = agora()
    em = dados.em or momento
    if em - momento > TOLERANCIA_FUTURO:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "hora da foto está no futuro")
    if momento - em > LIMITE_PASSADO:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "foto antiga demais")
    desconhecidas = servico.processar_observacoes(db, camera, em, dados.mesas)
    return ResultadoIngest(
        processadas=len(dados.mesas) - len(desconhecidas), mesas_desconhecidas=desconhecidas
    )
