"""Liga as contas do estoque ao banco: baixa pelo pedido, estorno, compra, perda, contagem,
ficha técnica e o custo dos pratos. Toda mudança no saldo vira uma linha no livro
(`movimentos_estoque`), com quem lançou e quando."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from giro.dominio.estoque import (
    MOTIVO_PRATO_CANCELADO,
    Diferenca,
    LinhaFicha,
    TipoMovimento,
    Unidade,
    baixa,
    custo_da_ficha,
    custo_medio,
    diferencas_da_contagem,
)
from giro.modelos import FichaTecnica, Insumo, ItemCardapio, ItemPedido, MovimentoEstoque


def mover(
    db: Session,
    insumo_id: int,
    restaurante_id: int,
    tipo: TipoMovimento,
    quantidade: int,
    em: datetime,
    *,
    valor_centavos: int | None = None,
    item_pedido_id: int | None = None,
    motivo: str | None = None,
    usuario_id: int | None = None,
) -> MovimentoEstoque:
    """Soma no saldo direto no banco (duas vendas ao mesmo tempo não se perdem) e anota a
    linha no livro com o saldo que ficou."""
    db.execute(update(Insumo).where(Insumo.id == insumo_id).values(saldo=Insumo.saldo + quantidade))
    saldo = db.scalar(select(Insumo.saldo).where(Insumo.id == insumo_id))
    movimento = MovimentoEstoque(
        restaurante_id=restaurante_id,
        insumo_id=insumo_id,
        tipo=tipo.value,
        quantidade=quantidade,
        saldo_depois=saldo or 0,
        valor_centavos=valor_centavos,
        item_pedido_id=item_pedido_id,
        motivo=motivo,
        usuario_id=usuario_id,
        em=em,
    )
    db.add(movimento)
    return movimento


def fichas_dos_itens(db: Session, item_ids: set[int]) -> dict[int, dict[int, int]]:
    """{prato: {ingrediente: quantidade por porção}}."""
    fichas: dict[int, dict[int, int]] = defaultdict(dict)
    if not item_ids:
        return fichas
    linhas = db.execute(
        select(FichaTecnica.item_id, FichaTecnica.insumo_id, FichaTecnica.quantidade).where(
            FichaTecnica.item_id.in_(item_ids)
        )
    )
    for item_id, insumo_id, quantidade in linhas:
        fichas[item_id][insumo_id] = quantidade
    return fichas


def baixar_pedidos(db: Session, pedidos: list[ItemPedido], em: datetime) -> None:
    """O prato foi lançado: sai do estoque o que a ficha diz. Prato sem ficha não mexe."""
    fichas = fichas_dos_itens(db, {p.item_id for p in pedidos})
    for pedido in pedidos:
        for insumo_id, quantidade in sorted(
            baixa(fichas[pedido.item_id], pedido.quantidade).items()
        ):
            mover(
                db,
                insumo_id,
                pedido.restaurante_id,
                TipoMovimento.VENDA,
                -quantidade,
                em,
                item_pedido_id=pedido.id,
                usuario_id=pedido.lancado_por_id,
            )


def cancelar_pedido(db: Session, pedido: ItemPedido, usuario_id: int | None, em: datetime) -> None:
    """Cancelado antes do "Pronto", volta para o estoque. Depois do "Pronto", o prato foi feito:
    volta como venda desfeita e sai como perda, para o fim do mês saber o que se perdeu."""
    saidas = db.execute(
        select(MovimentoEstoque.insumo_id, func.sum(MovimentoEstoque.quantidade))
        .where(
            MovimentoEstoque.item_pedido_id == pedido.id,
            MovimentoEstoque.tipo == TipoMovimento.VENDA.value,
        )
        .group_by(MovimentoEstoque.insumo_id)
        .order_by(MovimentoEstoque.insumo_id)
    ).all()
    for insumo_id, total in saidas:
        comum = {"item_pedido_id": pedido.id, "usuario_id": usuario_id}
        mover(db, insumo_id, pedido.restaurante_id, TipoMovimento.ESTORNO, -total, em, **comum)
        if pedido.pronto_em is not None:
            mover(
                db,
                insumo_id,
                pedido.restaurante_id,
                TipoMovimento.PERDA,
                total,
                em,
                motivo=MOTIVO_PRATO_CANCELADO,
                **comum,
            )


def _travar(db: Session, insumo_ids: list[int]) -> dict[int, Insumo]:
    """Lê os ingredientes travados (no Postgres) e com os valores do banco, não os da memória."""
    insumos = db.scalars(
        select(Insumo)
        .where(Insumo.id.in_(insumo_ids))
        .order_by(Insumo.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    return {i.id: i for i in insumos}


def registrar_compra(
    db: Session,
    insumo: Insumo,
    quantidade: int,
    valor_centavos: int | None,
    usuario_id: int | None,
    em: datetime,
) -> None:
    """Chegou compra: entra no estoque e o preço vira o custo médio do que tinha com o que
    chegou. Os pratos que usam o ingrediente acompanham o preço novo."""
    atual = _travar(db, [insumo.id])[insumo.id]
    preco = custo_medio(
        atual.saldo, atual.custo_centavos, quantidade, valor_centavos, atual.unidade
    )
    mover(
        db,
        insumo.id,
        insumo.restaurante_id,
        TipoMovimento.COMPRA,
        quantidade,
        em,
        valor_centavos=valor_centavos,
        usuario_id=usuario_id,
    )
    if preco != atual.custo_centavos:
        atual.custo_centavos = preco
        db.flush()
        atualizar_custo_dos_pratos(db, insumo.restaurante_id, insumos={insumo.id})


def registrar_contagem(
    db: Session, restaurante_id: int, contados: dict[int, int], usuario_id: int | None, em: datetime
) -> list[Diferenca]:
    """O que foi contado substitui a conta. Fica no livro mesmo quando bate (diferença zero):
    assim dá para saber quando cada ingrediente foi contado pela última vez."""
    atuais = _travar(db, sorted(contados))
    diferencas = diferencas_da_contagem({i: a.saldo for i, a in atuais.items()}, contados)
    for d in diferencas:
        mover(
            db,
            d.insumo_id,
            restaurante_id,
            TipoMovimento.CONTAGEM,
            d.diferenca,
            em,
            usuario_id=usuario_id,
        )
    return diferencas


def custos_das_fichas(
    db: Session, restaurante_id: int, itens: set[int] | None = None
) -> dict[int, int | None]:
    """Custo de uma porção pela ficha, de cada prato que tem ficha."""
    consulta = (
        select(FichaTecnica.item_id, FichaTecnica.quantidade, Insumo.unidade, Insumo.custo_centavos)
        .join(Insumo, FichaTecnica.insumo_id == Insumo.id)
        .where(FichaTecnica.restaurante_id == restaurante_id)
    )
    if itens is not None:
        consulta = consulta.where(FichaTecnica.item_id.in_(itens))
    linhas: dict[int, list[LinhaFicha]] = defaultdict(list)
    for item_id, quantidade, unidade, custo in db.execute(consulta):
        linhas[item_id].append(LinhaFicha(quantidade, Unidade(unidade), custo))
    outros = dict(
        db.execute(
            select(ItemCardapio.id, ItemCardapio.custo_outros_centavos).where(
                ItemCardapio.id.in_(list(linhas))
            )
        ).all()
    )
    return {item_id: custo_da_ficha(ls, outros.get(item_id)) for item_id, ls in linhas.items()}


def atualizar_custo_dos_pratos(
    db: Session,
    restaurante_id: int,
    insumos: set[int] | None = None,
    itens: set[int] | None = None,
) -> None:
    """Com ficha, o custo do prato é o da ficha: a matriz de lucro fica sempre em dia. Sem
    preço em algum ingrediente, o prato fica com o custo que já tinha."""
    alvo = set(itens or set())
    if insumos:
        alvo |= set(
            db.scalars(select(FichaTecnica.item_id).where(FichaTecnica.insumo_id.in_(insumos)))
        )
    if not alvo:
        return
    for item_id, custo in custos_das_fichas(db, restaurante_id, alvo).items():
        if custo is not None:
            db.execute(
                update(ItemCardapio).where(ItemCardapio.id == item_id).values(custo_centavos=custo)
            )


def salvar_ficha(
    db: Session,
    item: ItemCardapio,
    linhas: dict[int, int],
    outros_centavos: int | None,
    muda_outros: bool,
) -> None:
    """Troca a ficha do prato inteira. Ficha vazia tira o prato do estoque; o custo que ele
    tinha fica, e volta a ser digitado no cardápio."""
    db.execute(delete(FichaTecnica).where(FichaTecnica.item_id == item.id))
    db.add_all(
        FichaTecnica(
            restaurante_id=item.restaurante_id,
            item_id=item.id,
            insumo_id=insumo_id,
            quantidade=quantidade,
        )
        for insumo_id, quantidade in sorted(linhas.items())
    )
    if muda_outros:
        item.custo_outros_centavos = outros_centavos
    db.flush()
    atualizar_custo_dos_pratos(db, item.restaurante_id, itens={item.id})


def itens_com_ficha(db: Session, restaurante_id: int) -> set[int]:
    return set(
        db.scalars(
            select(FichaTecnica.item_id).where(FichaTecnica.restaurante_id == restaurante_id)
        )
    )


def recalcular_saldos(db: Session, restaurante_id: int) -> None:
    """Saldo = soma do livro. Usado pela demonstração depois de refazer o histórico."""
    somas = dict(
        db.execute(
            select(MovimentoEstoque.insumo_id, func.sum(MovimentoEstoque.quantidade))
            .where(MovimentoEstoque.restaurante_id == restaurante_id)
            .group_by(MovimentoEstoque.insumo_id)
        ).all()
    )
    for insumo in db.scalars(select(Insumo).where(Insumo.restaurante_id == restaurante_id)):
        insumo.saldo = int(somas.get(insumo.id) or 0)
