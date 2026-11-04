"""Contas do cardápio para os resultados: o que mais saiu, o que cada mesa pediu e o ticket
real. Tudo vem dos itens lançados nas visitas do período; item cancelado não conta."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.modelos import CategoriaCardapio, ItemCardapio, ItemPedido, Mesa, Ocupacao, Restaurante
from giro.servicos.resultados import MINIMO_VISITAS_TICKET_REAL, Periodo, intervalo


@dataclass
class ItemVendido:
    item_id: int
    nome: str
    categoria: str
    bebida: bool
    quantidade: int = 0
    receita_centavos: int = 0


@dataclass
class MesaCardapio:
    numero: int
    visitas: int
    pessoas: int
    total_centavos: int
    prato: str | None
    prato_quantidade: int
    bebida: str | None
    bebida_quantidade: int


@dataclass
class ResultadosCardapio:
    periodo: Periodo
    dia: date
    faturamento_centavos: int
    visitas_com_pedido: int
    pessoas: int
    ticket_real_centavos: int | None
    itens: list[ItemVendido]
    mesas: list[MesaCardapio]


def _favorito(contagem: dict[int, int], vendidos: dict[int, ItemVendido], bebida: bool):
    candidatos = [(q, i) for i, q in contagem.items() if vendidos[i].bebida == bebida]
    if not candidatos:
        return None, 0
    quantidade, item_id = max(candidatos, key=lambda c: (c[0], -c[1]))
    return vendidos[item_id].nome, quantidade


def resultados_cardapio(
    db: Session, restaurante: Restaurante, periodo: Periodo, dia: date, agora: datetime
) -> ResultadosCardapio:
    inicio, fim = intervalo(periodo, dia)
    fim = min(fim, agora)
    linhas = db.execute(
        select(ItemPedido, Ocupacao.pessoas, ItemCardapio.nome, CategoriaCardapio)
        .join(Ocupacao, ItemPedido.ocupacao_id == Ocupacao.id)
        .join(ItemCardapio, ItemPedido.item_id == ItemCardapio.id)
        .join(CategoriaCardapio, ItemCardapio.categoria_id == CategoriaCardapio.id)
        .where(
            ItemPedido.restaurante_id == restaurante.id,
            Ocupacao.sentou_em >= inicio,
            Ocupacao.sentou_em < fim,
            ItemPedido.cancelado_em.is_(None),
        )
    ).all()
    numeros = {
        m.id: m.numero
        for m in db.scalars(select(Mesa).where(Mesa.restaurante_id == restaurante.id))
    }

    vendidos: dict[int, ItemVendido] = {}
    pessoas_da_visita: dict[int, int] = {}
    gasto_da_visita: dict[int, int] = defaultdict(int)
    por_mesa: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    visitas_da_mesa: dict[int, set[int]] = defaultdict(set)
    for pedido, pessoas, nome_atual, categoria in linhas:
        valor = pedido.quantidade * pedido.preco_unit_centavos
        item = vendidos.setdefault(
            pedido.item_id,
            ItemVendido(pedido.item_id, nome_atual, categoria.nome, categoria.bebida),
        )
        item.quantidade += pedido.quantidade
        item.receita_centavos += valor
        pessoas_da_visita[pedido.ocupacao_id] = pessoas
        gasto_da_visita[pedido.ocupacao_id] += valor
        por_mesa[pedido.mesa_id][pedido.item_id] += pedido.quantidade
        visitas_da_mesa[pedido.mesa_id].add(pedido.ocupacao_id)

    # Ticket real: só visitas em que a câmera contou as pessoas.
    contadas = [v for v, p in pessoas_da_visita.items() if p > 0]
    ticket = None
    if len(contadas) >= MINIMO_VISITAS_TICKET_REAL:
        ticket = round(
            sum(gasto_da_visita[v] for v in contadas) / sum(pessoas_da_visita[v] for v in contadas)
        )

    mesas = []
    for mesa_id, contagem in por_mesa.items():
        visitas = visitas_da_mesa[mesa_id]
        prato, prato_qtd = _favorito(contagem, vendidos, bebida=False)
        bebida, bebida_qtd = _favorito(contagem, vendidos, bebida=True)
        mesas.append(
            MesaCardapio(
                numero=numeros.get(mesa_id, 0),
                visitas=len(visitas),
                pessoas=sum(pessoas_da_visita[v] for v in visitas),
                total_centavos=sum(gasto_da_visita[v] for v in visitas),
                prato=prato,
                prato_quantidade=prato_qtd,
                bebida=bebida,
                bebida_quantidade=bebida_qtd,
            )
        )

    return ResultadosCardapio(
        periodo=periodo,
        dia=dia,
        faturamento_centavos=sum(gasto_da_visita.values()),
        visitas_com_pedido=len(pessoas_da_visita),
        pessoas=sum(pessoas_da_visita.values()),
        ticket_real_centavos=ticket,
        itens=sorted(vendidos.values(), key=lambda i: (-i.quantidade, -i.receita_centavos)),
        mesas=sorted(mesas, key=lambda m: m.numero),
    )
