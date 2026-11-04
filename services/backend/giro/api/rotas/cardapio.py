"""Cardápio do restaurante. Todos veem; gerente e dono cadastram; custo só o dono vê e muda.
"Acabou" (disponível hoje) qualquer um da equipe marca, porque quem sabe é a cozinha."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from giro.api.deps import (
    GESTAO,
    Db,
    RestauranteAlvo,
    UsuarioAtual,
    exigir_papel,
    restaurante_permitido,
)
from giro.esquemas import (
    CardapioSaida,
    CategoriaAtualizacao,
    CategoriaEntrada,
    CategoriaSaida,
    DisponivelEntrada,
    ItemCardapioAtualizacao,
    ItemCardapioEntrada,
    ItemCardapioSaida,
)
from giro.modelos import CategoriaCardapio, ItemCardapio, Papel, Usuario

router = APIRouter(prefix="/api/cardapio", tags=["cardápio"])

VEEM_CUSTO = (Papel.DONO, Papel.ADMIN_GIRO)


def _ve_custo(usuario: Usuario) -> bool:
    return usuario.papel in VEEM_CUSTO


def item_saida(item: ItemCardapio, usuario: Usuario) -> ItemCardapioSaida:
    saida = ItemCardapioSaida.model_validate(item)
    if not _ve_custo(usuario):
        saida.custo_centavos = None
    return saida


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
    return CardapioSaida(
        categorias=[CategoriaSaida.model_validate(c) for c in categorias if gestao or c.ativa],
        itens=[item_saida(i, usuario) for i in itens if gestao or i.ativo],
        mostra_custo=_ve_custo(usuario),
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
    dados: ItemCardapioEntrada, db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo
) -> ItemCardapioSaida:
    _so_dono_muda_custo(usuario, dados.custo_centavos)
    _categoria_do_restaurante(db, dados.categoria_id, restaurante_id)
    item = ItemCardapio(restaurante_id=restaurante_id, **dados.model_dump())
    db.add(item)
    db.commit()
    return item_saida(item, usuario)


@router.patch("/itens/{item_id}", dependencies=[exigir_papel(*GESTAO)])
def atualizar_item(
    item_id: int, dados: ItemCardapioAtualizacao, db: Db, usuario: UsuarioAtual
) -> ItemCardapioSaida:
    """Preço novo vale só para os próximos pedidos: o que já foi lançado guardou o preço."""
    item = _item(db, item_id, usuario)
    mudancas = dados.model_dump(exclude_unset=True)
    if "custo_centavos" in mudancas and not _ve_custo(usuario):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "só o dono informa o custo dos pratos")
    if mudancas.get("categoria_id") is not None:
        _categoria_do_restaurante(db, mudancas["categoria_id"], item.restaurante_id)
    for campo, valor in mudancas.items():
        setattr(item, campo, valor)
    db.commit()
    return item_saida(item, usuario)


@router.post("/itens/{item_id}/disponivel")
def marcar_disponivel(
    item_id: int, dados: DisponivelEntrada, db: Db, usuario: UsuarioAtual
) -> ItemCardapioSaida:
    """A cozinha avisa que acabou (ou que voltou). Vale na hora para todos os garçons."""
    item = _item(db, item_id, usuario)
    item.disponivel = dados.disponivel
    db.commit()
    return item_saida(item, usuario)
