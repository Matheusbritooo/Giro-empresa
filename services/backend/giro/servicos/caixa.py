"""A planilha do caixa no banco: prévia, importação e a conferência com os pedidos do GIRO.

A conferência compara, nas noites que vieram do caixa, o que o caixa vendeu com o que foi
lançado no GIRO, no total da noite e por item (pelo item do cardápio que o dono associou ao
nome do caixa). Diferença grande quer dizer pedido que não passou pelo GIRO: o estoque não
baixou e os resultados não viram.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from giro.dominio.caixa import ErroPlanilha, Leitura, ler_planilha, sugerir_item
from giro.dominio.indicadores import intervalo_da_noite, noite_de
from giro.modelos import ItemCardapio, ItemPedido, Usuario, VendaCaixa
from giro.servicos.atividades import GrupoAtividade, reais, registrar

ITENS_NA_CONFERENCIA = 15


@dataclass
class NomeDoCaixa:
    nome: str
    quantidade: int
    valor_centavos: int
    sugestao_item_id: int | None


@dataclass
class Previa:
    leitura: Leitura
    de: date
    ate: date
    noites: int
    total_centavos: int
    nomes: list[NomeDoCaixa]
    noites_ja_importadas: int  # serão trocadas pela importação


def _itens(db: Session, restaurante_id: int) -> list[tuple[int, str]]:
    linhas = db.execute(
        select(ItemCardapio.id, ItemCardapio.nome).where(
            ItemCardapio.restaurante_id == restaurante_id
        )
    )
    return [(item_id, nome) for item_id, nome in linhas]


def _somar(leitura: Leitura) -> dict[tuple[date, str], tuple[int, int]]:
    somas: dict[tuple[date, str], list[int]] = defaultdict(lambda: [0, 0])
    for linha in leitura.linhas:
        soma = somas[(linha.noite, linha.nome)]
        soma[0] += linha.quantidade
        soma[1] += linha.valor_centavos
    return {chave: (q, v) for chave, (q, v) in somas.items()}


def previa(db: Session, restaurante_id: int, texto: str) -> Previa:
    leitura = ler_planilha(texto)
    if not leitura.linhas:
        raise ErroPlanilha("Nenhuma linha com data, produto e valor na planilha.")
    noites = {linha.noite for linha in leitura.linhas}
    itens = _itens(db, restaurante_id)
    por_nome: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for linha in leitura.linhas:
        por_nome[linha.nome][0] += linha.quantidade
        por_nome[linha.nome][1] += linha.valor_centavos
    ja = db.scalars(
        select(VendaCaixa.noite)
        .where(VendaCaixa.restaurante_id == restaurante_id, VendaCaixa.noite.in_(noites))
        .distinct()
    ).all()
    return Previa(
        leitura=leitura,
        de=min(noites),
        ate=max(noites),
        noites=len(noites),
        total_centavos=sum(linha.valor_centavos for linha in leitura.linhas),
        nomes=sorted(
            (
                NomeDoCaixa(nome, q, v, sugerir_item(nome, itens))
                for nome, (q, v) in por_nome.items()
            ),
            key=lambda n: (-n.valor_centavos, n.nome),
        ),
        noites_ja_importadas=len(ja),
    )


def importar(
    db: Session,
    restaurante_id: int,
    usuario: Usuario,
    texto: str,
    associacoes: dict[str, int | None],
    agora: datetime,
) -> Previa:
    """Troca as noites da planilha pelas linhas novas. Nome sem associação fica sem item (entra
    no total da noite, não na conferência por item)."""
    feita = previa(db, restaurante_id, texto)
    noites = {linha.noite for linha in feita.leitura.linhas}
    db.execute(
        delete(VendaCaixa).where(
            VendaCaixa.restaurante_id == restaurante_id, VendaCaixa.noite.in_(noites)
        )
    )
    sugestoes = {n.nome: n.sugestao_item_id for n in feita.nomes}
    for (noite, nome), (quantidade, valor) in sorted(_somar(feita.leitura).items()):
        db.add(
            VendaCaixa(
                restaurante_id=restaurante_id,
                noite=noite,
                nome=nome,
                item_id=associacoes.get(nome, sugestoes.get(nome)),
                quantidade=quantidade,
                valor_centavos=valor,
                importado_em=agora,
                importado_por_id=usuario.id,
            )
        )
    periodo = (
        feita.de.strftime("%d/%m")
        if feita.de == feita.ate
        else f"{feita.de.strftime('%d/%m')} a {feita.ate.strftime('%d/%m')}"
    )
    registrar(
        db,
        restaurante_id,
        usuario,
        GrupoAtividade.CAIXA,
        f"Importou a planilha do caixa de {periodo}: {feita.noites} "
        f"{'noite' if feita.noites == 1 else 'noites'}, {reais(feita.total_centavos)}",
        agora,
    )
    db.commit()
    return feita


@dataclass
class NoiteConferida:
    noite: date
    caixa_centavos: int
    giro_centavos: int


@dataclass
class ItemConferido:
    nome: str  # o do cardápio (ou o do caixa, se não tem associação)
    item_id: int | None
    caixa_quantidade: int
    giro_quantidade: int
    caixa_centavos: int
    giro_centavos: int


@dataclass
class Conferencia:
    noites: list[NoiteConferida]
    itens: list[ItemConferido]
    caixa_centavos: int
    giro_centavos: int
    sem_associacao: list[str]  # nomes do caixa que não viraram item do cardápio


def conferencia(db: Session, restaurante_id: int, de: date, ate: date) -> Conferencia:
    """Só as noites que vieram do caixa entram (as outras não têm com o que comparar)."""
    vendas = db.scalars(
        select(VendaCaixa).where(
            VendaCaixa.restaurante_id == restaurante_id,
            VendaCaixa.noite >= de,
            VendaCaixa.noite <= ate,
        )
    ).all()
    noites = sorted({v.noite for v in vendas})
    if not noites:
        return Conferencia([], [], 0, 0, [])
    inicio, _ = intervalo_da_noite(noites[0])
    _, fim = intervalo_da_noite(noites[-1])
    pedidos = db.execute(
        select(
            ItemPedido.lancado_em,
            ItemPedido.item_id,
            ItemPedido.nome,
            ItemPedido.quantidade,
            ItemPedido.quantidade * ItemPedido.preco_unit_centavos,
        ).where(
            ItemPedido.restaurante_id == restaurante_id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= inicio,
            ItemPedido.lancado_em < fim,
        )
    ).all()
    com_caixa = set(noites)
    giro_noite: dict[date, int] = defaultdict(int)
    giro_item: dict[int, list] = defaultdict(lambda: [0, 0, ""])
    for lancado, item_id, nome, quantidade, valor in pedidos:
        noite = noite_de(lancado)
        if noite not in com_caixa:
            continue
        giro_noite[noite] += int(valor)
        soma = giro_item[item_id]
        soma[0] += quantidade
        soma[1] += int(valor)
        soma[2] = nome

    caixa_noite: dict[date, int] = defaultdict(int)
    caixa_item: dict[object, list] = defaultdict(lambda: [0, 0, ""])
    for v in vendas:
        caixa_noite[v.noite] += v.valor_centavos
        chave = v.item_id if v.item_id is not None else f"caixa:{v.nome}"
        soma = caixa_item[chave]
        soma[0] += v.quantidade
        soma[1] += v.valor_centavos
        soma[2] = soma[2] or v.nome

    nomes_cardapio = dict(_itens(db, restaurante_id))
    itens = []
    for chave in set(caixa_item) | set(giro_item):
        cq, cv, cnome = caixa_item.get(chave, [0, 0, ""])
        gq, gv, gnome = giro_item.get(chave, [0, 0, ""])
        item_id = chave if isinstance(chave, int) else None
        nome = nomes_cardapio.get(item_id, "") if item_id else cnome
        itens.append(ItemConferido(nome or gnome or cnome, item_id, cq, gq, cv, gv))
    itens.sort(key=lambda i: (-abs(i.caixa_centavos - i.giro_centavos), i.nome))
    return Conferencia(
        noites=[NoiteConferida(n, caixa_noite[n], giro_noite.get(n, 0)) for n in noites],
        itens=itens[:ITENS_NA_CONFERENCIA],
        caixa_centavos=sum(caixa_noite.values()),
        giro_centavos=sum(giro_noite.values()),
        sem_associacao=sorted({v.nome for v in vendas if v.item_id is None}),
    )


def caixa_do_periodo(db: Session, restaurante_id: int, de: date, ate: date) -> int | None:
    """O total do caixa nas noites importadas do período; None quando não há importação."""
    valores = db.scalars(
        select(VendaCaixa.valor_centavos).where(
            VendaCaixa.restaurante_id == restaurante_id,
            VendaCaixa.noite >= de,
            VendaCaixa.noite <= ate,
        )
    ).all()
    return sum(valores) if valores else None
