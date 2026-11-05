"""Cardápio do restaurante. Todos veem; gerente e dono cadastram; custo só o dono vê e muda.
"Acabou" (disponível hoje) qualquer um da equipe marca, porque quem sabe é a cozinha.

Prato com ficha técnica tem o custo calculado pela ficha: não se digita."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

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
from giro.esquemas import (
    CardapioSaida,
    CategoriaAtualizacao,
    CategoriaEntrada,
    CategoriaSaida,
    DisponivelEntrada,
    FichaEntrada,
    FichaSaida,
    ItemCardapioAtualizacao,
    ItemCardapioEntrada,
    ItemCardapioSaida,
)
from giro.modelos import CategoriaCardapio, Insumo, ItemCardapio, ItemPedido, Papel, Usuario
from giro.servicos import estoque as servico_estoque

router = APIRouter(prefix="/api/cardapio", tags=["cardápio"])

VEEM_CUSTO = (Papel.DONO, Papel.ADMIN_GIRO)
MAIS_PEDIDOS = 8
JANELA_MAIS_PEDIDOS = timedelta(days=28)


def _ve_custo(usuario: Usuario) -> bool:
    return usuario.papel in VEEM_CUSTO


def item_saida(item: ItemCardapio, usuario: Usuario, com_ficha: bool) -> ItemCardapioSaida:
    saida = ItemCardapioSaida.model_validate(item)
    saida.custo_pela_ficha = com_ficha
    if not _ve_custo(usuario):
        saida.custo_centavos = None
    return saida


def _tem_ficha(db, item: ItemCardapio) -> bool:
    return item.id in servico_estoque.itens_com_ficha(db, item.restaurante_id)


def _categoria_do_restaurante(db, categoria_id: int, restaurante_id: int) -> CategoriaCardapio:
    categoria = db.get(CategoriaCardapio, categoria_id)
    if categoria is None or categoria.restaurante_id != restaurante_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "categoria não encontrada")
    return categoria


def _item(db, item_id: int, usuario: Usuario) -> ItemCardapio:
    item = db.get(ItemCardapio, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item não encontrado")
    restaurante_permitido(usuario, item.restaurante_id)
    return item


def _avisar_mudanca(servico, restaurante_id: int) -> None:
    """Celulares e cozinha buscam o cardápio de novo (preço, "acabou", item novo)."""
    servico.central.publicar(restaurante_id, {"tipo": "cardapio"})


def _so_dono_muda_custo(usuario: Usuario, custo: int | None) -> None:
    if custo is not None and not _ve_custo(usuario):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "só o dono informa o custo dos pratos")


@router.get("")
def ver_cardapio(db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo) -> CardapioSaida:
    """Gestão vê também o que saiu do cardápio (para voltar com ele); a equipe, só o ativo."""
    gestao = usuario.papel in GESTAO
    categorias = db.scalars(
        select(CategoriaCardapio)
        .where(CategoriaCardapio.restaurante_id == restaurante_id)
        .order_by(CategoriaCardapio.ordem, CategoriaCardapio.id)
    ).all()
    itens = db.scalars(
        select(ItemCardapio)
        .where(ItemCardapio.restaurante_id == restaurante_id)
        .order_by(ItemCardapio.nome)
    ).all()
    quantidade = func.sum(ItemPedido.quantidade)
    mais_pedidos = db.scalars(
        select(ItemPedido.item_id)
        .join(ItemCardapio, ItemPedido.item_id == ItemCardapio.id)
        .where(
            ItemPedido.restaurante_id == restaurante_id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= agora() - JANELA_MAIS_PEDIDOS,
            ItemCardapio.ativo.is_(True),
        )
        .group_by(ItemPedido.item_id)
        .order_by(quantidade.desc(), ItemPedido.item_id)
        .limit(MAIS_PEDIDOS)
    ).all()
    com_ficha = servico_estoque.itens_com_ficha(db, restaurante_id)
    return CardapioSaida(
        categorias=[CategoriaSaida.model_validate(c) for c in categorias if gestao or c.ativa],
        itens=[item_saida(i, usuario, i.id in com_ficha) for i in itens if gestao or i.ativo],
        mostra_custo=_ve_custo(usuario),
        mais_pedidos=list(mais_pedidos),
    )


@router.post(
    "/categorias", status_code=status.HTTP_201_CREATED, dependencies=[exigir_papel(*GESTAO)]
)
def criar_categoria(
    dados: CategoriaEntrada, db: Db, restaurante_id: RestauranteAlvo
) -> CategoriaSaida:
    categoria = CategoriaCardapio(restaurante_id=restaurante_id, **dados.model_dump())
    db.add(categoria)
    db.commit()
    return CategoriaSaida.model_validate(categoria)


@router.patch("/categorias/{categoria_id}", dependencies=[exigir_papel(*GESTAO)])
def atualizar_categoria(
    categoria_id: int, dados: CategoriaAtualizacao, db: Db, usuario: UsuarioAtual
) -> CategoriaSaida:
    categoria = db.get(CategoriaCardapio, categoria_id)
    if categoria is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "categoria não encontrada")
    restaurante_permitido(usuario, categoria.restaurante_id)
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(categoria, campo, valor)
    db.commit()
    return CategoriaSaida.model_validate(categoria)


@router.post("/itens", status_code=status.HTTP_201_CREATED, dependencies=[exigir_papel(*GESTAO)])
def criar_item(
    dados: ItemCardapioEntrada,
    db: Db,
    usuario: UsuarioAtual,
    restaurante_id: RestauranteAlvo,
    servico: Servico,
) -> ItemCardapioSaida:
    _so_dono_muda_custo(usuario, dados.custo_centavos)
    _categoria_do_restaurante(db, dados.categoria_id, restaurante_id)
    item = ItemCardapio(restaurante_id=restaurante_id, **dados.model_dump())
    db.add(item)
    db.commit()
    _avisar_mudanca(servico, restaurante_id)
    return item_saida(item, usuario, com_ficha=False)


@router.patch("/itens/{item_id}", dependencies=[exigir_papel(*GESTAO)])
def atualizar_item(
    item_id: int, dados: ItemCardapioAtualizacao, db: Db, usuario: UsuarioAtual, servico: Servico
) -> ItemCardapioSaida:
    """Preço novo vale só para os próximos pedidos: o que já foi lançado guardou o preço."""
    item = _item(db, item_id, usuario)
    mudancas = dados.model_dump(exclude_unset=True)
    if "custo_centavos" in mudancas and not _ve_custo(usuario):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "só o dono informa o custo dos pratos")
    com_ficha = _tem_ficha(db, item)
    if "custo_centavos" in mudancas and com_ficha:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"o custo de {item.nome} vem da ficha técnica: mude a ficha no Estoque",
        )
    if mudancas.get("categoria_id") is not None:
        _categoria_do_restaurante(db, mudancas["categoria_id"], item.restaurante_id)
    for campo, valor in mudancas.items():
        setattr(item, campo, valor)
    db.commit()
    _avisar_mudanca(servico, item.restaurante_id)
    return item_saida(item, usuario, com_ficha)


@router.post("/itens/{item_id}/disponivel")
def marcar_disponivel(
    item_id: int, dados: DisponivelEntrada, db: Db, usuario: UsuarioAtual, servico: Servico
) -> ItemCardapioSaida:
    """A cozinha avisa que acabou (ou que voltou). Vale na hora para todos os garçons."""
    item = _item(db, item_id, usuario)
    item.disponivel = dados.disponivel
    db.commit()
    _avisar_mudanca(servico, item.restaurante_id)
    return item_saida(item, usuario, _tem_ficha(db, item))


@router.post("/itens/{item_id}/ficha", dependencies=[exigir_papel(*GESTAO)])
def salvar_ficha(
    item_id: int, dados: FichaEntrada, db: Db, usuario: UsuarioAtual, servico: Servico
) -> FichaSaida:
    """Troca a ficha inteira do prato. Gerente monta a receita; o custo de "outros"
    (tempero, óleo) só o dono informa. Lista vazia tira o prato do estoque."""
    item = _item(db, item_id, usuario)
    muda_outros = "custo_outros_centavos" in dados.model_fields_set
    if muda_outros and not _ve_custo(usuario):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "só o dono informa o custo dos pratos")
    linhas = {linha.insumo_id: linha.quantidade for linha in dados.linhas}
    if len(linhas) != len(dados.linhas):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "ingrediente repetido na ficha")
    do_restaurante = set(
        db.scalars(
            select(Insumo.id).where(
                Insumo.id.in_(list(linhas)), Insumo.restaurante_id == item.restaurante_id
            )
        )
    )
    if do_restaurante != set(linhas):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ingrediente não encontrado")

    def salvar() -> None:
        servico_estoque.salvar_ficha(db, item, linhas, dados.custo_outros_centavos, muda_outros)

    servico.mexer_no_estoque(db, item.restaurante_id, salvar)
    _avisar_mudanca(servico, item.restaurante_id)  # o custo do prato pode ter mudado
    ve_custo = _ve_custo(usuario)
    custo = servico_estoque.custos_das_fichas(db, item.restaurante_id, {item.id}).get(item.id)
    return FichaSaida(
        item_id=item.id,
        linhas=[{"insumo_id": i, "quantidade": q} for i, q in sorted(linhas.items())],
        custo_outros_centavos=item.custo_outros_centavos if ve_custo else None,
        custo_centavos=custo if ve_custo else None,
    )
