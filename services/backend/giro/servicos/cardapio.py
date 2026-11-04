"""Contas do cardápio para os resultados: o que mais saiu, o que cada mesa pediu, o ticket
real, a matriz de lucro (só para quem vê custo), o que combina com o quê e o tempo de
cozinha. Tudo vem dos itens lançados nas visitas do período; item cancelado não conta."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.dominio.cardapio import (
    Matriz,
    TempoDePreparo,
    Venda,
    combinacoes,
    matriz_de_lucro,
    minutos_ate_vagar,
    tempo_de_preparo,
)
from giro.dominio.indicadores import FUSO
from giro.modelos import CategoriaCardapio, ItemCardapio, ItemPedido, Mesa, Ocupacao, Restaurante
from giro.servicos.resultados import MINIMO_VISITAS_TICKET_REAL, Periodo, intervalo

# Para quantos pratos mostrar "quem pede também pede".
PRATOS_COM_COMBINACAO = 3
ACOMPANHAMENTO = 0.6
# A previsão de vaga olha as últimas 4 semanas de contas pedidas.
JANELA_PREVISAO = timedelta(days=28)
SEXTA, SABADO = 4, 5


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
class MatrizCategoria:
    categoria: str
    matriz: Matriz


@dataclass
class Acompanha:
    nome: str
    percentual: int


@dataclass
class Combinacao:
    item: str
    acompanha: list[Acompanha]


@dataclass
class TempoDoItem:
    nome: str
    tempo: TempoDePreparo


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
    # None quando quem pede não vê custo (só o dono vê).
    matrizes: list[MatrizCategoria] | None = None
    combinacoes: list[Combinacao] = field(default_factory=list)
    tempos: list[TempoDoItem] = field(default_factory=list)


def _favorito(contagem: dict[int, int], vendidos: dict[int, ItemVendido], bebida: bool):
    candidatos = [(q, i) for i, q in contagem.items() if vendidos[i].bebida == bebida]
    if not candidatos:
        return None, 0
    quantidade, item_id = max(candidatos, key=lambda c: (c[0], -c[1]))
    return vendidos[item_id].nome, quantidade


def resultados_cardapio(
    db: Session,
    restaurante: Restaurante,
    periodo: Periodo,
    dia: date,
    agora: datetime,
    com_custo: bool = False,
) -> ResultadosCardapio:
    inicio, fim = intervalo(periodo, dia)
    fim = min(fim, agora)
    linhas = db.execute(
        select(ItemPedido, Ocupacao.pessoas, ItemCardapio, CategoriaCardapio)
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
    itens_cardapio: dict[int, ItemCardapio] = {}
    categoria_do_item: dict[int, CategoriaCardapio] = {}
    pessoas_da_visita: dict[int, int] = {}
    gasto_da_visita: dict[int, int] = defaultdict(int)
    itens_da_visita: dict[int, set[int]] = defaultdict(set)
    por_mesa: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    visitas_da_mesa: dict[int, set[int]] = defaultdict(set)
    preparo: dict[int, list[tuple[float, bool]]] = defaultdict(list)
    for pedido, pessoas, item, categoria in linhas:
        valor = pedido.quantidade * pedido.preco_unit_centavos
        vendido = vendidos.setdefault(
            pedido.item_id, ItemVendido(pedido.item_id, item.nome, categoria.nome, categoria.bebida)
        )
        vendido.quantidade += pedido.quantidade
        vendido.receita_centavos += valor
        itens_cardapio[item.id] = item
        categoria_do_item[item.id] = categoria
        pessoas_da_visita[pedido.ocupacao_id] = pessoas
        gasto_da_visita[pedido.ocupacao_id] += valor
        itens_da_visita[pedido.ocupacao_id].add(pedido.item_id)
        por_mesa[pedido.mesa_id][pedido.item_id] += pedido.quantidade
        visitas_da_mesa[pedido.mesa_id].add(pedido.ocupacao_id)
        if pedido.pronto_em is not None:
            minutos = (pedido.pronto_em - pedido.lancado_em).total_seconds() / 60
            lotado = pedido.lancado_em.astimezone(FUSO).weekday() in (SEXTA, SABADO)
            preparo[pedido.item_id].append((minutos, lotado))

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

    ranking = sorted(vendidos.values(), key=lambda i: (-i.quantidade, -i.receita_centavos))
    return ResultadosCardapio(
        periodo=periodo,
        dia=dia,
        faturamento_centavos=sum(gasto_da_visita.values()),
        visitas_com_pedido=len(pessoas_da_visita),
        pessoas=sum(pessoas_da_visita.values()),
        ticket_real_centavos=ticket,
        itens=ranking,
        mesas=sorted(mesas, key=lambda m: m.numero),
        matrizes=_matrizes(vendidos, itens_cardapio, categoria_do_item) if com_custo else None,
        combinacoes=_combinacoes(ranking, itens_da_visita, categoria_do_item),
        tempos=_tempos(vendidos, preparo),
    )


def _matrizes(
    vendidos: dict[int, ItemVendido],
    itens: dict[int, ItemCardapio],
    categoria_do_item: dict[int, CategoriaCardapio],
) -> list[MatrizCategoria]:
    """Uma matriz por categoria (massa compete com massa, não com refrigerante), da que mais
    fatura para a que menos."""
    por_categoria: dict[int, list[Venda]] = defaultdict(list)
    for item_id, v in vendidos.items():
        por_categoria[categoria_do_item[item_id].id].append(
            Venda(item_id, v.nome, v.quantidade, v.receita_centavos, itens[item_id].custo_centavos)
        )
    receita = {c: sum(v.receita_centavos for v in vs) for c, vs in por_categoria.items()}
    nomes = {c.id: c.nome for c in categoria_do_item.values()}
    saida = []
    for categoria_id in sorted(por_categoria, key=lambda c: -receita[c]):
        matriz = matriz_de_lucro(por_categoria[categoria_id])
        if matriz is not None:
            saida.append(MatrizCategoria(nomes[categoria_id], matriz))
    return saida


def _combinacoes(
    ranking: list[ItemVendido],
    itens_da_visita: dict[int, set[int]],
    categoria_do_item: dict[int, CategoriaCardapio],
) -> list[Combinacao]:
    """Para os pratos que mais saem: o que as mesas que pediram também pediram para
    acompanhar (o garçom oferece a bebida e a sobremesa certas). Acompanhamento é bebida ou
    item de outra categoria que custa menos que 60% do prato: entrada, sobremesa. Assim um
    prato não "combina" com outro prato só porque a mesa era grande."""
    nomes = {i.item_id: i.nome for i in ranking}
    preco_medio = {i.item_id: i.receita_centavos / i.quantidade for i in ranking}
    visitas = list(itens_da_visita.values())
    saida = []
    for prato in [i for i in ranking if not i.bebida][:PRATOS_COM_COMBINACAO]:
        categoria = categoria_do_item[prato.item_id].id
        candidatos = {
            i
            for i, c in categoria_do_item.items()
            if c.bebida
            or (c.id != categoria and preco_medio[i] < ACOMPANHAMENTO * preco_medio[prato.item_id])
        }
        pares = combinacoes(visitas, prato.item_id, candidatos)
        if pares:
            acompanha = [Acompanha(nomes[i], round(f * 100)) for i, f in pares]
            saida.append(Combinacao(prato.nome, acompanha))
    return saida


def _tempos(
    vendidos: dict[int, ItemVendido], preparo: dict[int, list[tuple[float, bool]]]
) -> list[TempoDoItem]:
    """Tempo de cozinha dos pratos (bebida não entra), do mais demorado para o mais rápido."""
    tempos = []
    for item_id, amostras in preparo.items():
        if vendidos[item_id].bebida:
            continue
        tempo = tempo_de_preparo(amostras)
        if tempo is not None:
            tempos.append(TempoDoItem(vendidos[item_id].nome, tempo))
    return sorted(tempos, key=lambda t: -t.tempo.minutos)


def previsao_de_vaga(db: Session, restaurante_id: int, agora: datetime) -> int:
    """Minutos que as mesas deste restaurante costumam levar para vagar depois da conta."""
    linhas = db.execute(
        select(Ocupacao.conta_pedida_em, Ocupacao.saiu_em).where(
            Ocupacao.restaurante_id == restaurante_id,
            Ocupacao.conta_pedida_em.is_not(None),
            Ocupacao.saiu_em.is_not(None),
            Ocupacao.sentou_em >= agora - JANELA_PREVISAO,
        )
    ).all()
    return minutos_ate_vagar([(saiu - conta).total_seconds() / 60 for conta, saiu in linhas])
