"""Pedidos das mesas: o garçom lança, a cozinha marca pronto, o gerente cancela com motivo.

O pedido fica preso à visita da mesa (tabela `ocupacoes`). Lançar o primeiro item conta como
atendimento e tira o alerta de "mesa sem atendimento"."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from giro.api.deps import (
    GESTAO,
    Db,
    RestauranteAlvo,
    Servico,
    UsuarioAtual,
    exigir_papel,
    restaurante_permitido,
)
from giro.banco import agora
from giro.dominio.mesa import TransicaoInvalida
from giro.esquemas import (
    CancelamentoEntrada,
    ContaEntrada,
    ItemCozinhaSaida,
    ItemPedidoSaida,
    MesaSalao,
    PedidoEntrada,
    PedidoMesaSaida,
)
from giro.modelos import ItemCardapio, ItemPedido, Mesa, Usuario
from giro.servicos.salao import mesas_salao, ocupacoes_abertas

router = APIRouter(prefix="/api", tags=["pedidos"])

# A tela da cozinha mostra o que foi lançado nas últimas horas e ainda não saiu.
JANELA_COZINHA = timedelta(hours=12)


def _mesa(db, mesa_id: int, usuario: Usuario) -> Mesa:
    mesa = db.get(Mesa, mesa_id)
    if mesa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mesa não encontrada")
    restaurante_permitido(usuario, mesa.restaurante_id)
    return mesa


def _item_pedido(db, pedido_id: int, usuario: Usuario) -> ItemPedido:
    pedido = db.get(ItemPedido, pedido_id)
    if pedido is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item do pedido não encontrado")
    restaurante_permitido(usuario, pedido.restaurante_id)
    return pedido


def pedido_da_mesa(db, mesa: Mesa) -> PedidoMesaSaida:
    """O que a visita em curso já pediu (vazio com a mesa livre)."""
    ocupacao = ocupacoes_abertas(db, [mesa.id]).get(mesa.id)
    itens = []
    if ocupacao is not None:
        itens = db.scalars(
            select(ItemPedido)
            .where(ItemPedido.ocupacao_id == ocupacao.id)
            .order_by(ItemPedido.lancado_em, ItemPedido.id)
        ).all()
    total = sum(i.quantidade * i.preco_unit_centavos for i in itens if i.cancelado_em is None)
    return PedidoMesaSaida(
        mesa=mesas_salao(db, [mesa])[0],
        itens=[ItemPedidoSaida.model_validate(i) for i in itens],
        total_centavos=total,
    )


@router.get("/mesas/{mesa_id}/pedido")
def ver_pedido(mesa_id: int, db: Db, usuario: UsuarioAtual) -> PedidoMesaSaida:
    return pedido_da_mesa(db, _mesa(db, mesa_id, usuario))


@router.post("/mesas/{mesa_id}/pedidos", status_code=status.HTTP_201_CREATED)
def lancar_pedido(
    mesa_id: int, dados: PedidoEntrada, db: Db, usuario: UsuarioAtual, servico: Servico
) -> PedidoMesaSaida:
    mesa = _mesa(db, mesa_id, usuario)
    if not mesa.ativa:
        raise HTTPException(status.HTTP_409_CONFLICT, f"a mesa {mesa.numero} está desativada")
    ids = {linha.item_id for linha in dados.itens}
    itens = {
        i.id: i
        for i in db.scalars(
            select(ItemCardapio).where(
                ItemCardapio.id.in_(ids), ItemCardapio.restaurante_id == mesa.restaurante_id
            )
        )
    }
    linhas = []
    for linha in dados.itens:
        item = itens.get(linha.item_id)
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item não encontrado no cardápio")
        if not item.ativo:
            raise HTTPException(status.HTTP_409_CONFLICT, f"{item.nome} saiu do cardápio")
        if not item.disponivel:
            raise HTTPException(status.HTTP_409_CONFLICT, f"{item.nome} acabou")
        observacao = (linha.observacao or "").strip() or None
        linhas.append((item, linha.quantidade, observacao))
    servico.registrar_pedido(db, mesa, linhas, usuario.id, agora())
    return pedido_da_mesa(db, mesa)


@router.post("/mesas/{mesa_id}/conta")
def pedir_conta(
    mesa_id: int, dados: ContaEntrada, db: Db, usuario: UsuarioAtual, servico: Servico
) -> MesaSalao:
    """A mesa pediu a conta: o salão mostra quando ela deve vagar. `pedida=false` desfaz."""
    mesa = _mesa(db, mesa_id, usuario)
    try:
        servico.pedir_conta(db, mesa, dados.pedida, agora())
    except TransicaoInvalida as erro:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"a mesa {mesa.numero} não está ocupada"
        ) from erro
    return mesas_salao(db, [mesa])[0]


@router.post("/pedidos/{pedido_id}/pronto")
def marcar_pronto(
    pedido_id: int, db: Db, usuario: UsuarioAtual, servico: Servico
) -> ItemPedidoSaida:
    pedido = _item_pedido(db, pedido_id, usuario)
    if pedido.cancelado_em is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "esse item foi cancelado")
    if pedido.pronto_em is None:
        pedido.pronto_em = agora()
        db.commit()
        servico.avisar_pedido(db, pedido.mesa)
    return ItemPedidoSaida.model_validate(pedido)


@router.post("/pedidos/{pedido_id}/cancelar", dependencies=[exigir_papel(*GESTAO)])
def cancelar(
    pedido_id: int, dados: CancelamentoEntrada, db: Db, usuario: UsuarioAtual, servico: Servico
) -> ItemPedidoSaida:
    """Só gerente e dono cancelam, sempre com motivo. Fica quem cancelou e quando."""
    pedido = _item_pedido(db, pedido_id, usuario)
    if pedido.cancelado_em is None:
        pedido.cancelado_em = agora()
        pedido.cancelado_por_id = usuario.id
        pedido.motivo_cancelamento = dados.motivo
        db.commit()
        servico.avisar_pedido(db, pedido.mesa)
    return ItemPedidoSaida.model_validate(pedido)


@router.get("/cozinha")
def ver_cozinha(db: Db, restaurante_id: RestauranteAlvo) -> list[ItemCozinhaSaida]:
    """O que falta sair, do mais antigo para o mais novo."""
    pedidos = db.scalars(
        select(ItemPedido)
        .where(
            ItemPedido.restaurante_id == restaurante_id,
            ItemPedido.pronto_em.is_(None),
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= agora() - JANELA_COZINHA,
        )
        .order_by(ItemPedido.lancado_em, ItemPedido.id)
    ).all()
    return [
        ItemCozinhaSaida(
            **ItemPedidoSaida.model_validate(p).model_dump(), mesa_numero=p.mesa.numero
        )
        for p in pedidos
    ]
