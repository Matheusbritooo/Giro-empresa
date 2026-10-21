"""Porta de entrada do que a câmera viu.

Hoje quem chama é o simulador. Na Fase 2 será o worker de visão, com o mesmo formato:
a foto é analisada e descartada antes de chegar aqui. Esta rota nunca recebe imagem.
"""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from giro.api.deps import CameraAutenticada, Db, Servico
from giro.banco import agora
from giro.esquemas import ConfiguracaoCamera, ObservacoesEntrada, ZonaMesaSaida
from giro.modelos import Mesa

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


@router.get("/configuracao")
def configuracao(camera: CameraAutenticada, db: Db) -> ConfiguracaoCamera:
    """O serviço de visão pergunta: de quem é esta câmera e onde estão as mesas na imagem."""
    mesas = db.scalars(
        select(Mesa)
        .where(
            Mesa.camera_id == camera.id,
            Mesa.restaurante_id == camera.restaurante_id,
            Mesa.ativa.is_(True),
            Mesa.poligono.is_not(None),
        )
        .order_by(Mesa.numero)
    ).all()
    return ConfiguracaoCamera(
        camera_id=camera.id,
        restaurante_id=camera.restaurante_id,
        mesas=[ZonaMesaSaida(numero=m.numero, poligono=m.poligono) for m in mesas],
        ajustes=camera.ajustes_visao or {},
    )
