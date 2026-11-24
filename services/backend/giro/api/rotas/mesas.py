import secrets

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from giro.api.deps import (
    GESTAO,
    Db,
    RestauranteAlvo,
    UsuarioAtual,
    exigir_papel,
    restaurante_permitido,
)
from giro.dominio.mesa import Estado
from giro.esquemas import MesaAtualizacao, MesaEntrada, MesaSalao
from giro.modelos import Camera, Mesa
from giro.servicos.atividades import GrupoAtividade, de_para, registrar
from giro.servicos.salao import mesa_salao, mesas_salao, ocupacoes_abertas

router = APIRouter(prefix="/api/mesas", tags=["mesas"], dependencies=[exigir_papel(*GESTAO)])


class QrMesaSaida(BaseModel):
    mesa_id: int
    numero: int
    chave: str  # o painel monta o endereço do QR: <painel>/m/<chave>


def _nova_chave() -> str:
    return secrets.token_urlsafe(16)  # 22 letras: impossível de adivinhar


@router.get("")
def listar(db: Db, restaurante_id: RestauranteAlvo) -> list[MesaSalao]:
    mesas = db.scalars(
        select(Mesa).where(Mesa.restaurante_id == restaurante_id).order_by(Mesa.numero)
    ).all()
    return mesas_salao(db, list(mesas))


@router.post("", status_code=status.HTTP_201_CREATED)
def criar(
    dados: MesaEntrada, db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo
) -> MesaSalao:
    mesa = Mesa(restaurante_id=restaurante_id, **dados.model_dump())
    db.add(mesa)
    registrar(
        db,
        restaurante_id,
        usuario,
        GrupoAtividade.MESAS,
        f"Cadastrou a mesa {mesa.numero}, de {mesa.lugares} lugares",
    )
    try:
        db.commit()
    except IntegrityError as erro:
        raise HTTPException(status.HTTP_409_CONFLICT, f"já existe a mesa {dados.numero}") from erro
    return mesa_salao(mesa, None)


def _o_que_mudou_na_mesa(mesa: Mesa, mudancas: dict) -> list[str]:
    numero = mudancas.get("numero", mesa.numero)
    frases = []
    if "numero" in mudancas and mudancas["numero"] != mesa.numero:
        frases.append(f"Mudou o número da mesa {mesa.numero} para {numero}")
    if "lugares" in mudancas and mudancas["lugares"] != mesa.lugares:
        frases.append(de_para(f"Lugares da mesa {numero}", mesa.lugares, mudancas["lugares"]))
    if "ativa" in mudancas and mudancas["ativa"] != mesa.ativa:
        frases.append(f"{'Reativou' if mudancas['ativa'] else 'Desativou'} a mesa {numero}")
    if ("pos_x" in mudancas and mudancas["pos_x"] != mesa.pos_x) or (
        "pos_y" in mudancas and mudancas["pos_y"] != mesa.pos_y
    ):
        frases.append(f"Mudou a mesa {numero} de lugar na planta")
    if "poligono" in mudancas and mudancas["poligono"] != mesa.poligono:
        frases.append(
            f"Desenhou a mesa {numero} na foto da câmera"
            if mudancas["poligono"]
            else f"Apagou o desenho da mesa {numero} na câmera"
        )
    return frases


@router.patch("/{mesa_id}")
def atualizar(mesa_id: int, dados: MesaAtualizacao, db: Db, usuario: UsuarioAtual) -> MesaSalao:
    mesa = db.get(Mesa, mesa_id)
    if mesa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mesa não encontrada")
    restaurante_permitido(usuario, mesa.restaurante_id)
    mudancas = dados.model_dump(exclude_unset=True)
    if mudancas.get("camera_id") is not None:
        camera = db.get(Camera, mudancas["camera_id"])
        # A câmera tem que ser do mesmo restaurante da mesa.
        if camera is None or camera.restaurante_id != mesa.restaurante_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "câmera não encontrada")
    if "poligono" in mudancas and mudancas["poligono"] is not None:
        mudancas["poligono"] = [list(ponto) for ponto in mudancas["poligono"]]
    if mudancas.get("ativa") is False and mesa.estado != Estado.LIVRE:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "só dá para desativar a mesa quando ela estiver livre"
        )
    for frase in _o_que_mudou_na_mesa(mesa, mudancas):
        registrar(db, mesa.restaurante_id, usuario, GrupoAtividade.MESAS, frase)
    for campo, valor in mudancas.items():
        setattr(mesa, campo, valor)
    try:
        db.commit()
    except IntegrityError as erro:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "já existe uma mesa com esse número"
        ) from erro
    return mesa_salao(mesa, ocupacoes_abertas(db, [mesa.id]).get(mesa.id))


@router.get("/qr")
def ver_qr(db: Db, restaurante_id: RestauranteAlvo) -> list[QrMesaSaida]:
    """O QR de cada mesa ativa, para imprimir. A mesa que ainda não tinha ganha o seu agora."""
    mesas = db.scalars(
        select(Mesa)
        .where(Mesa.restaurante_id == restaurante_id, Mesa.ativa.is_(True))
        .order_by(Mesa.numero)
    ).all()
    novas = [m for m in mesas if not m.chave_publica]
    for mesa in novas:
        mesa.chave_publica = _nova_chave()
    if novas:
        db.commit()
    return [QrMesaSaida(mesa_id=m.id, numero=m.numero, chave=m.chave_publica or "") for m in mesas]


@router.post("/{mesa_id}/qr/trocar")
def trocar_qr(mesa_id: int, db: Db, usuario: UsuarioAtual) -> QrMesaSaida:
    """Troca a chave do QR da mesa: o QR impresso antes para de funcionar."""
    mesa = db.get(Mesa, mesa_id)
    if mesa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mesa não encontrada")
    restaurante_permitido(usuario, mesa.restaurante_id)
    mesa.chave_publica = _nova_chave()
    registrar(
        db,
        mesa.restaurante_id,
        usuario,
        GrupoAtividade.MESAS,
        f"Trocou o QR da mesa {mesa.numero} (o impresso antes parou de funcionar)",
    )
    db.commit()
    return QrMesaSaida(mesa_id=mesa.id, numero=mesa.numero, chave=mesa.chave_publica)
