from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from giro.api.deps import Db, RestauranteAlvo, Servico, UsuarioAtual, restaurante_permitido
from giro.banco import agora
from giro.dominio.mesa import TransicaoInvalida
from giro.esquemas import AlertaSaida, CameraSaida, MesaSalao, RestauranteSaida, SalaoSaida
from giro.modelos import Alerta, Camera, Mesa, Restaurante
from giro.servicos.salao import alerta_saida, mesa_salao, ocupacoes_abertas

router = APIRouter(prefix="/api", tags=["salão"])


def montar_salao(db, restaurante_id: int) -> SalaoSaida:
    restaurante = db.get(Restaurante, restaurante_id)
    if restaurante is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "restaurante não encontrado")
    mesas = db.scalars(
        select(Mesa)
        .where(Mesa.restaurante_id == restaurante_id, Mesa.ativa.is_(True))
        .order_by(Mesa.numero)
    ).all()
    ocupacoes = ocupacoes_abertas(db, [m.id for m in mesas])
    alertas = db.scalars(
        select(Alerta)
        .where(Alerta.restaurante_id == restaurante_id, Alerta.resolvido_em.is_(None))
        .order_by(Alerta.criado_em)
    ).all()
    cameras = db.scalars(
        select(Camera).where(Camera.restaurante_id == restaurante_id).order_by(Camera.id)
    ).all()
    return SalaoSaida(
        restaurante=RestauranteSaida.model_validate(restaurante),
        mesas=[mesa_salao(m, ocupacoes.get(m.id)) for m in mesas],
        alertas=[alerta_saida(a) for a in alertas],
        cameras=[CameraSaida.model_validate(c) for c in cameras],
        agora=agora(),
    )


@router.get("/salao")
def ver_salao(db: Db, restaurante_id: RestauranteAlvo) -> SalaoSaida:
    return montar_salao(db, restaurante_id)


@router.post("/mesas/{mesa_id}/liberar")
def liberar(mesa_id: int, db: Db, usuario: UsuarioAtual, servico: Servico) -> MesaSalao:
    mesa = db.get(Mesa, mesa_id)
    if mesa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mesa não encontrada")
    restaurante_permitido(usuario, mesa.restaurante_id)
    try:
        servico.liberar_mesa(db, mesa, agora())
    except TransicaoInvalida as erro:
        raise HTTPException(status.HTTP_409_CONFLICT, str(erro)) from erro
    return mesa_salao(mesa, ocupacoes_abertas(db, [mesa.id]).get(mesa.id))


@router.post("/alertas/{alerta_id}/reconhecer")
def reconhecer(alerta_id: int, db: Db, usuario: UsuarioAtual, servico: Servico) -> AlertaSaida:
    """Alguém viu o alerta e está indo (continua na lista até a mesa ser atendida)."""
    alerta = db.get(Alerta, alerta_id)
    if alerta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alerta não encontrado")
    restaurante_permitido(usuario, alerta.restaurante_id)
    saida = alerta_saida(alerta)
    if alerta.reconhecido_em is None:
        alerta.reconhecido_em = agora()
        alerta.reconhecido_por_id = usuario.id
        db.commit()
        saida = alerta_saida(alerta)
        # Os outros aparelhos param de mostrar o botão "Vou atender".
        servico.central.publicar(
            alerta.restaurante_id, {"tipo": "alerta", "alerta": saida.model_dump(mode="json")}
        )
    return saida
