"""Liga a previsão ao banco: o que cada prato vendeu nas últimas 4 semanas, a ficha, o
estoque de agora e os ajustes do restaurante (dias de compra e folga).

A noite de hoje entra só com o que ainda falta vender: se a previsão é de 22 lasanhas e já
saíram 15, contam 7."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.dominio.compras import (
    HORIZONTE,
    SEMANAS,
    LinhaDeCompra,
    Situacao,
    ler_dias_de_compra,
    linha_de_compra,
    noites_cobertas,
    previsao,
    proxima_compra,
    quando_acaba,
    saidas_previstas,
    situacao,
    sobrando,
)
from giro.dominio.estoque import custo_de
from giro.dominio.indicadores import intervalo_da_noite, noite_de
from giro.modelos import (
    CategoriaCardapio,
    FichaTecnica,
    Insumo,
    ItemCardapio,
    ItemPedido,
    Restaurante,
)


@dataclass
class NoiteDoPrato:
    noite: date
    previstos: int
    ultimas: list[int]  # as 4 noites iguais que deram a conta, da mais antiga à mais recente
    ja_vendidos: int = 0  # só hoje: o que já saiu (a conta usa só o que falta)


@dataclass
class PrevisaoDoPrato:
    item_id: int
    nome: str
    noites: list[NoiteDoPrato]  # as noites que a compra cobre


@dataclass
class PratoNaConta:
    item_id: int
    nome: str
    por_porcao: int
    pratos: int  # previstos nas noites que a compra cobre


@dataclass
class ItemDoPlano:
    insumo: Insumo
    linha: LinhaDeCompra
    situacao: Situacao
    acaba_em: date | None
    pratos: list[PratoNaConta]
    valor_centavos: int | None  # estimado pelo custo médio; None sem preço ou sem compra


@dataclass
class PlanoDeCompras:
    hoje: date
    compra: date  # o dia da próxima compra (hoje, se hoje é dia de compra)
    antes: list[date]  # as noites de hoje até a véspera da compra
    cobre: list[date]  # as noites que a compra cobre
    folga_pct: int
    itens: list[ItemDoPlano]  # todos os ingredientes em uso
    pratos: list[PrevisaoDoPrato]


def _vendas_por_noite(
    db: Session, restaurante_id: int, item_ids: set[int], desde: datetime
) -> dict[int, dict[date, int]]:
    vendas: dict[int, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    if not item_ids:
        return vendas
    linhas = db.execute(
        select(ItemPedido.item_id, ItemPedido.quantidade, ItemPedido.lancado_em).where(
            ItemPedido.restaurante_id == restaurante_id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= desde,
            ItemPedido.item_id.in_(item_ids),
        )
    )
    for item_id, quantidade, lancado in linhas:
        vendas[item_id][noite_de(lancado)] += quantidade
    return vendas


def plano_de_compras(
    db: Session, restaurante: Restaurante, agora: datetime, folga_pct: int | None = None
) -> PlanoDeCompras:
    hoje = noite_de(agora)
    dias = ler_dias_de_compra(restaurante.dias_compra)
    folga = restaurante.folga_compra_pct if folga_pct is None else folga_pct
    compra = proxima_compra(hoje, dias)
    antes = [hoje + timedelta(days=n) for n in range((compra - hoje).days)]
    cobre = noites_cobertas(compra, dias)
    horizonte = [hoje + timedelta(days=n) for n in range(HORIZONTE)]
    noites = sorted(set(antes) | set(cobre) | set(horizonte))

    insumos = db.scalars(
        select(Insumo)
        .where(Insumo.restaurante_id == restaurante.id, Insumo.ativo.is_(True))
        .order_by(Insumo.nome)
    ).all()
    # Só pratos ativos: o que saiu do cardápio não vai vender mais.
    fichas: dict[int, dict[int, int]] = defaultdict(dict)
    nomes: dict[int, str] = {}
    for item_id, nome, insumo_id, quantidade in db.execute(
        select(ItemCardapio.id, ItemCardapio.nome, FichaTecnica.insumo_id, FichaTecnica.quantidade)
        .join(FichaTecnica, FichaTecnica.item_id == ItemCardapio.id)
        .where(ItemCardapio.restaurante_id == restaurante.id, ItemCardapio.ativo.is_(True))
    ):
        fichas[item_id][insumo_id] = quantidade
        nomes[item_id] = nome

    desde, _ = intervalo_da_noite(hoje - timedelta(weeks=SEMANAS))
    vendas = _vendas_por_noite(db, restaurante.id, set(fichas), desde)
    previstos: dict[int, dict[date, int]] = {}
    contas: dict[int, dict[date, tuple[int, list[int]]]] = {}
    for item_id in fichas:
        por_noite = {noite: previsao(vendas[item_id], noite, hoje) for noite in noites}
        contas[item_id] = por_noite
        previstos[item_id] = {noite: p for noite, (p, _) in por_noite.items()}
        # Hoje, só o que ainda falta vender.
        previstos[item_id][hoje] = max(previstos[item_id][hoje] - vendas[item_id].get(hoje, 0), 0)
    saidas = saidas_previstas(previstos, fichas)

    itens = []
    for insumo in insumos:
        sai = saidas.get(insumo.id, {})
        linha = linha_de_compra(
            insumo.saldo,
            sum(sai.get(n, 0) for n in antes),
            sum(sai.get(n, 0) for n in cobre),
            folga,
            insumo.embalagem_quantidade,
        )
        pratos = sorted(
            (
                PratoNaConta(
                    item_id,
                    nomes[item_id],
                    ficha[insumo.id],
                    sum(previstos[item_id][n] for n in cobre),
                )
                for item_id, ficha in fichas.items()
                if insumo.id in ficha
            ),
            key=lambda p: (-p.pratos * p.por_porcao, p.nome),
        )
        valor = None
        if linha.quantidade and insumo.custo_centavos is not None:
            valor = round(custo_de(linha.quantidade, insumo.unidade, insumo.custo_centavos))
        acaba_em = quando_acaba(insumo.saldo, [(n, sai.get(n, 0)) for n in horizonte])
        itens.append(
            ItemDoPlano(
                insumo=insumo,
                linha=linha,
                situacao=situacao(linha, acaba_em, compra),
                acaba_em=acaba_em,
                pratos=[p for p in pratos if p.pratos],
                valor_centavos=valor,
            )
        )

    return PlanoDeCompras(
        hoje=hoje,
        compra=compra,
        antes=antes,
        cobre=cobre,
        folga_pct=folga,
        itens=itens,
        pratos=[
            PrevisaoDoPrato(
                item_id,
                nomes[item_id],
                [
                    NoiteDoPrato(
                        n, *contas[item_id][n], vendas[item_id].get(n, 0) if n == hoje else 0
                    )
                    for n in cobre
                ],
            )
            for item_id in sorted(fichas, key=lambda i: nomes[i])
        ],
    )


@dataclass
class PratoDoDia:
    item_id: int
    nome: str
    insumo: str  # o ingrediente que está sobrando
    compra: date  # a próxima compra, que ele já cobre sozinho


SUGESTOES_DO_DIA = 2


def pratos_do_dia(db: Session, plano: PlanoDeCompras) -> list[PratoDoDia]:
    """Os pratos para a equipe oferecer hoje: os que mais usam um ingrediente sobrando (o que
    tem cobre a próxima compra inteira sem comprar nada). Bebida não entra: é sugestão de
    prato. Só pratos ativos e com "tem hoje"."""
    sobrando_ids = {
        i.insumo.id: i.insumo.nome
        for i in plano.itens
        if sobrando(i.insumo.saldo, i.linha.sobra, i.linha.precisa)
    }
    if not sobrando_ids:
        return []
    linhas = db.execute(
        select(
            ItemCardapio.id,
            ItemCardapio.nome,
            ItemCardapio.preco_centavos,
            FichaTecnica.insumo_id,
            FichaTecnica.quantidade,
        )
        .join(FichaTecnica, FichaTecnica.item_id == ItemCardapio.id)
        .join(CategoriaCardapio, ItemCardapio.categoria_id == CategoriaCardapio.id)
        .where(
            FichaTecnica.insumo_id.in_(list(sobrando_ids)),
            ItemCardapio.ativo.is_(True),
            ItemCardapio.disponivel.is_(True),
            CategoriaCardapio.bebida.is_(False),
        )
    ).all()
    # O prato que leva mais do ingrediente por porção é o que mais ajuda a girar o estoque.
    linhas = sorted(linhas, key=lambda x: (-x.quantidade, -x.preco_centavos, x.nome))
    sugestoes: list[PratoDoDia] = []
    for item_id, nome, _, insumo_id, _ in linhas:
        if any(s.item_id == item_id or s.insumo == sobrando_ids[insumo_id] for s in sugestoes):
            continue  # um prato por ingrediente, e o mesmo prato uma vez só
        sugestoes.append(PratoDoDia(item_id, nome, sobrando_ids[insumo_id], plano.compra))
        if len(sugestoes) == SUGESTOES_DO_DIA:
            break
    return sugestoes
