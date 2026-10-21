from fastapi import APIRouter, HTTPException, status
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
from giro.modelos import Mesa
from giro.servicos.salao import mesa_salao, ocupacoes_abertas

router = APIRouter(prefix="/api/mesas", tags=["mesas"], dependencies=[exigir_papel(*GESTAO)])


@router.get("")
def listar(db: Db, restaurante_id: RestauranteAlvo) -> list[MesaSalao]:
    mesas = db.scalars(
        select(Mesa).where(Mesa.restaurante_id == restaurante_id).order_by(Mesa.numero)
    ).all()
    ocupacoes = ocupacoes_abertas(db, [m.id for m in mesas])
    return [mesa_salao(m, ocupacoes.get(m.id)) for m in mesas]


@router.post("", status_code=status.HTTP_201_CREATED)
def criar(dados: MesaEntrada, db: Db, restaurante_id: RestauranteAlvo) -> MesaSalao:
    mesa = Mesa(restaurante_id=restaurante_id, **dados.model_dump())
    db.add(mesa)
    try:
        db.commit()
    except IntegrityError as erro:
        raise HTTPException(status.HTTP_409_CONFLICT, f"já existe a mesa {dados.numero}") from erro
    return mesa_salao(mesa, None)


@router.patch("/{mesa_id}")
def atualizar(mesa_id: int, dados: MesaAtualizacao, db: Db, usuario: UsuarioAtual) -> MesaSalao:
    mesa = db.get(Mesa, mesa_id)
    if mesa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mesa não encontrada")
    restaurante_permitido(usuario, mesa.restaurante_id)
    mudancas = dados.model_dump(exclude_unset=True)
    if mudancas.get("ativa") is False and mesa.estado != Estado.LIVRE:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "só dá para desativar a mesa quando ela estiver livre"
        )
    for campo, valor in mudancas.items():
        setattr(mesa, campo, valor)
    try:
        db.commit()
    except IntegrityError as erro:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "já existe uma mesa com esse número"
        ) from erro
    return mesa_salao(mesa, ocupacoes_abertas(db, [mesa.id]).get(mesa.id))
