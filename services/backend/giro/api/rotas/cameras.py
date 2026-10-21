"""Câmeras do restaurante: cadastro, calibração e prévia para desenhar as mesas."""

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from giro.api.cliente_visao import ClienteVisao, VisaoIndisponivel
from giro.api.deps import (
    GESTAO,
    Db,
    RestauranteAlvo,
    UsuarioAtual,
    exigir_papel,
    restaurante_permitido,
)
from giro.esquemas import (
    CameraAtualizacao,
    CameraCriada,
    CameraEntrada,
    CameraSaida,
    LeituraCamera,
)
from giro.modelos import Camera, Papel
from giro.seguranca import gerar_token_camera, hash_token

router = APIRouter(prefix="/api/cameras", tags=["câmeras"])

DONO_OU_ADMIN = exigir_papel(Papel.ADMIN_GIRO, Papel.DONO)
SEM_IMAGEM = "nenhuma imagem desta câmera nos últimos minutos; confira se o conector está ligado"


def _camera_permitida(db, usuario, camera_id: int) -> Camera:
    camera = db.get(Camera, camera_id)
    if camera is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "câmera não encontrada")
    restaurante_permitido(usuario, camera.restaurante_id)
    return camera


def _visao(request: Request) -> ClienteVisao:
    return request.app.state.visao


@router.get("", dependencies=[exigir_papel(*GESTAO)])
def listar(db: Db, restaurante_id: RestauranteAlvo) -> list[CameraSaida]:
    cameras = db.scalars(
        select(Camera).where(Camera.restaurante_id == restaurante_id).order_by(Camera.id)
    ).all()
    return [CameraSaida.model_validate(c) for c in cameras]


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[DONO_OU_ADMIN])
def criar(dados: CameraEntrada, db: Db, restaurante_id: RestauranteAlvo) -> CameraCriada:
    token = gerar_token_camera()
    camera = Camera(restaurante_id=restaurante_id, nome=dados.nome, token_hash=hash_token(token))
    db.add(camera)
    db.commit()
    return CameraCriada(**CameraSaida.model_validate(camera).model_dump(), token=token)


@router.patch("/{camera_id}", dependencies=[DONO_OU_ADMIN])
def atualizar(
    camera_id: int, dados: CameraAtualizacao, db: Db, usuario: UsuarioAtual
) -> CameraSaida:
    camera = _camera_permitida(db, usuario, camera_id)
    mudancas = dados.model_dump(exclude_unset=True)
    if "ajustes_visao" in mudancas:
        ajustes = mudancas.pop("ajustes_visao") or {}
        camera.ajustes_visao = {k: v for k, v in ajustes.items() if v is not None} or None
    for campo, valor in mudancas.items():
        setattr(camera, campo, valor)
    db.commit()
    return CameraSaida.model_validate(camera)


@router.get(
    "/{camera_id}/previa",
    dependencies=[exigir_papel(*GESTAO)],
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}},
)
def previa(camera_id: int, db: Db, usuario: UsuarioAtual, request: Request) -> Response:
    """Última foto da câmera com as pessoas pixeladas. Só existe na memória do serviço de visão."""
    camera = _camera_permitida(db, usuario, camera_id)
    try:
        imagem = _visao(request).previa(camera.id)
    except VisaoIndisponivel as erro:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(erro)) from erro
    if imagem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, SEM_IMAGEM)
    return Response(imagem, media_type="image/jpeg", headers={"cache-control": "no-store"})


@router.get("/{camera_id}/leitura", dependencies=[exigir_papel(*GESTAO)])
def leitura(camera_id: int, db: Db, usuario: UsuarioAtual, request: Request) -> LeituraCamera:
    """Quem a visão achou na última foto e em qual mesa, para conferir o desenho."""
    camera = _camera_permitida(db, usuario, camera_id)
    try:
        dados = _visao(request).leitura(camera.id)
    except VisaoIndisponivel as erro:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(erro)) from erro
    if dados is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, SEM_IMAGEM)
    return LeituraCamera.model_validate(dados)
