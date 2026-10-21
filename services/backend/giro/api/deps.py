"""Dependências comuns das rotas: banco, quem está logado e de qual restaurante."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.config import Config
from giro.modelos import Camera, Papel, Usuario
from giro.seguranca import hash_token, ler_token_sessao
from giro.servicos.salao import ServicoSalao

COOKIE_SESSAO = "giro_sessao"


def obter_db(request: Request) -> Iterator[Session]:
    with request.app.state.sessoes() as db:
        yield db


def obter_config(request: Request) -> Config:
    return request.app.state.config


def obter_servico(request: Request) -> ServicoSalao:
    return request.app.state.servico


Db = Annotated[Session, Depends(obter_db)]
ConfigAtual = Annotated[Config, Depends(obter_config)]
Servico = Annotated[ServicoSalao, Depends(obter_servico)]


def _token_do_pedido(request: Request) -> str | None:
    if token := request.cookies.get(COOKIE_SESSAO):
        return token
    cabecalho = request.headers.get("authorization", "")
    if cabecalho.lower().startswith("bearer "):
        return cabecalho[7:]
    return None


def usuario_do_token(db: Session, config: Config, token: str | None) -> Usuario | None:
    if not token:
        return None
    usuario_id = ler_token_sessao(token, config.segredo_jwt)
    if usuario_id is None:
        return None
    usuario = db.get(Usuario, usuario_id)
    if usuario is None or not usuario.ativo:
        return None
    return usuario


def usuario_atual(request: Request, db: Db, config: ConfigAtual) -> Usuario:
    usuario = usuario_do_token(db, config, _token_do_pedido(request))
    if usuario is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "faça login para continuar")
    return usuario


UsuarioAtual = Annotated[Usuario, Depends(usuario_atual)]


def exigir_papel(*papeis: Papel):
    def verificar(usuario: UsuarioAtual) -> Usuario:
        if usuario.papel not in papeis:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "seu perfil não tem acesso a isso")
        return usuario

    return Depends(verificar)


def restaurante_permitido(usuario: Usuario, restaurante_id: int | None) -> int:
    """Admin da GIRO escolhe o restaurante; os demais só enxergam o próprio."""
    if usuario.papel == Papel.ADMIN_GIRO:
        if restaurante_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "informe restaurante_id")
        return restaurante_id
    if usuario.restaurante_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "usuário sem restaurante")
    if restaurante_id is not None and restaurante_id != usuario.restaurante_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "restaurante não encontrado")
    return usuario.restaurante_id


def restaurante_alvo(
    usuario: UsuarioAtual, restaurante_id: Annotated[int | None, Query()] = None
) -> int:
    return restaurante_permitido(usuario, restaurante_id)


RestauranteAlvo = Annotated[int, Depends(restaurante_alvo)]

GESTAO = (Papel.ADMIN_GIRO, Papel.DONO, Papel.GERENTE)


def camera_autenticada(request: Request, db: Db) -> Camera:
    cabecalho = request.headers.get("authorization", "")
    token = cabecalho[7:] if cabecalho.lower().startswith("bearer ") else ""
    camera = None
    if token.startswith("cam_"):
        camera = db.scalar(select(Camera).where(Camera.token_hash == hash_token(token)))
    if camera is None or not camera.ativa:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token de câmera inválido")
    return camera


CameraAutenticada = Annotated[Camera, Depends(camera_autenticada)]
