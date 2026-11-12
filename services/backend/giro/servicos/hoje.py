"""A tela "Hoje": como está a noite até agora e o que pede atenção, numa lista só, do mais
urgente ao menos. Cada pendência diz o que fazer e leva para a tela onde se resolve.

O que muda de segundo em segundo (mesa esperando, alerta aberto, câmera sem sinal) o painel
pega do canal ao vivo. Aqui fica o que depende de conta: cozinha, estoque, compras e perdas.
Valores de custo (perdas em reais e preço que subiu) só entram para quem vê custo (o dono).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from giro.dominio.compras import Situacao
from giro.dominio.indicadores import Indicadores, intervalo_da_noite
from giro.modelos import FichaTecnica, ItemCardapio, ItemPedido, Mesa, Restaurante
from giro.servicos import copiloto
from giro.servicos.compras import PlanoDeCompras
from giro.servicos.perdas import texto_do_preco

COZINHA_ATRASADA = timedelta(minutes=20)  # item esperando mais que isso vira pendência
JANELA_COZINHA = timedelta(hours=12)  # a mesma da tela da cozinha


@dataclass
class Pendencia:
    tipo: str  # cozinha, vai_faltar, zerado, compra, contar, preco, perdas, acabou
    texto: str
    href: str  # a tela onde se resolve
    urgente: bool = False


@dataclass
class Hoje:
    dia: date
    dia_semana: str
    noite: Indicadores  # da abertura até agora
    vendeu_centavos: int
    noites_iguais: int  # quantas das 4 últimas noites iguais tiveram movimento
    costuma_mesas: int | None  # mesas atendidas, em média, nessas noites (a noite inteira)
    hora_pico: int | None
    pendencias: list[Pendencia]
    esperar: list[str]  # o que costuma acontecer neste dia da semana
    dicas: list[str]


def _lista(nomes: list[str], limite: int = 3) -> str:
    """ "muçarela, filé mignon e chopp", com "e mais 2" quando passa do limite."""
    mostra = [n.lower() for n in nomes[:limite]]
    if len(nomes) > limite:
        return f"{', '.join(mostra)} e mais {len(nomes) - limite}"
    return " e ".join([", ".join(mostra[:-1]), mostra[-1]]) if len(mostra) > 1 else mostra[0]


def _cozinha(db: Session, restaurante_id: int, agora: datetime) -> Pendencia | None:
    linhas = db.execute(
        select(ItemPedido.quantidade, ItemPedido.lancado_em, Mesa.numero)
        .join(Mesa, ItemPedido.mesa_id == Mesa.id)
        .where(
            ItemPedido.restaurante_id == restaurante_id,
            ItemPedido.pronto_em.is_(None),
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= agora - JANELA_COZINHA,
            ItemPedido.lancado_em < agora - COZINHA_ATRASADA,
        )
        .order_by(ItemPedido.lancado_em, ItemPedido.id)
    ).all()
    if not linhas:
        return None
    itens = sum(quantidade for quantidade, _, _ in linhas)
    _, mais_antigo, mesa = linhas[0]
    minutos = int((agora - mais_antigo).total_seconds() // 60)
    return Pendencia(
        "cozinha",
        f"{itens} {'item espera' if itens == 1 else 'itens esperam'} na cozinha há mais de "
        f"{COZINHA_ATRASADA.seconds // 60} min. O mais antigo é da mesa {mesa}, há {minutos} min.",
        "/cozinha",
        urgente=True,
    )


def _estoque(db: Session, plano: PlanoDeCompras) -> list[Pendencia]:
    pendencias = []
    zerados = [i.insumo for i in plano.itens if i.situacao == Situacao.ZERADO]
    if zerados:
        # Só pesa se ainda tem prato marcado "tem hoje" que leva o ingrediente.
        pratos = db.execute(
            select(FichaTecnica.insumo_id, ItemCardapio.nome)
            .join(ItemCardapio, FichaTecnica.item_id == ItemCardapio.id)
            .where(
                FichaTecnica.insumo_id.in_([i.id for i in zerados]),
                ItemCardapio.ativo.is_(True),
                ItemCardapio.disponivel.is_(True),
            )
            .order_by(ItemCardapio.nome)
        ).all()
        com_prato = {insumo_id for insumo_id, _ in pratos}
        nomes_pratos = list(dict.fromkeys(nome for _, nome in pratos))
        if nomes_pratos:
            acabou = _lista([i.nome for i in zerados if i.id in com_prato])
            pendencias.append(
                Pendencia(
                    "zerado",
                    f'Pela conta do estoque, acabou: {acabou}. Ainda como "tem hoje": '
                    f"{_lista(nomes_pratos)}. Confira a geladeira e, se faltar, marque acabou.",
                    "/estoque",
                    urgente=True,
                )
            )
    vai_faltar = [
        i for i in copiloto.acabam_antes_da_compra(plano) if i.situacao != Situacao.ZERADO
    ]
    dia_da_compra = copiloto.DIAS[plano.compra.weekday()]
    if vai_faltar:
        nomes = ", ".join(
            f"{i.insumo.nome.lower()} ({copiloto.quando_acaba(i.acaba_em, plano.hoje)})"
            for i in vai_faltar[:4]
        )
        if len(vai_faltar) > 4:
            nomes += f" e mais {len(vai_faltar) - 4}"
        pendencias.append(
            Pendencia(
                "vai_faltar",
                f"Acaba antes da compra de {dia_da_compra}: {nomes}. Confira a geladeira.",
                "/estoque",
                urgente=any(i.acaba_em == plano.hoje for i in vai_faltar),
            )
        )
    if plano.compra == plano.hoje:
        itens = sum(1 for i in plano.itens if i.linha.embalagens)
        if itens:
            pendencias.append(
                Pendencia(
                    "compra",
                    f"Hoje é dia de compra: {itens} {'item' if itens == 1 else 'itens'} na lista.",
                    "/estoque?aba=lista",
                )
            )
    return pendencias


def _acabou(db: Session, restaurante_id: int) -> Pendencia | None:
    nomes = list(
        db.scalars(
            select(ItemCardapio.nome)
            .where(
                ItemCardapio.restaurante_id == restaurante_id,
                ItemCardapio.ativo.is_(True),
                ItemCardapio.disponivel.is_(False),
            )
            .order_by(ItemCardapio.nome)
        )
    )
    if not nomes:
        return None
    return Pendencia(
        "acabou",
        f'{"Está" if len(nomes) == 1 else "Estão"} como "acabou": {_lista(nomes)}. '
        'Se chegou mercadoria, volte para "tem hoje".',
        "/cardapio",
    )


def painel_de_hoje(db: Session, restaurante: Restaurante, agora: datetime, com_custo: bool) -> Hoje:
    ctx = copiloto.montar_contexto(db, restaurante, agora, com_custo)
    inicio, fim = intervalo_da_noite(ctx.hoje)
    vendeu = db.scalar(
        select(func.sum(ItemPedido.quantidade * ItemPedido.preco_unit_centavos)).where(
            ItemPedido.restaurante_id == restaurante.id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= inicio,
            ItemPedido.lancado_em < min(fim, agora),
        )
    )

    pendencias: list[Pendencia] = []
    if (cozinha := _cozinha(db, restaurante.id, agora)) is not None:
        pendencias.append(cozinha)
    if ctx.plano is not None:
        pendencias.extend(_estoque(db, ctx.plano))
    if ctx.contar:
        pendencias.append(
            Pendencia(
                "contar",
                f"Hora de contar: {_lista(ctx.contar)}. São da curva A e estão há mais de uma "
                "semana sem contagem.",
                "/estoque",
            )
        )
    if com_custo and ctx.perdas is not None:
        for preco in ctx.perdas.precos[:2]:
            pendencias.append(
                Pendencia(
                    "preco",
                    texto_do_preco(preco.insumo, preco.subida, preco.pratos),
                    "/estoque?aba=perdas",
                )
            )
        if ctx.perdas.escapou_centavos > 0 and ctx.perdas.linhas:
            pior = ctx.perdas.linhas[0].insumo.nome.lower()
            pendencias.append(
                Pendencia(
                    "perdas",
                    "Nos últimos 7 dias escaparam "
                    f"{copiloto.em_reais(ctx.perdas.escapou_centavos)} do estoque. "
                    f"O que mais pesou: {pior}.",
                    "/estoque?aba=perdas",
                )
            )
    if (acabou := _acabou(db, restaurante.id)) is not None:
        pendencias.append(acabou)
    pendencias.sort(key=lambda p: not p.urgente)  # as urgentes primeiro, sem mexer no resto

    # O recado do salão, sem as dicas de estoque: essas já estão nas pendências.
    recado = copiloto.briefing(replace(ctx, compras=None, plano=None, cardapio=None, contar=[]))
    com_movimento = [r for r in ctx.mesmo_dia if r.noites]
    picos = [r.hora_pico for r in com_movimento if r.hora_pico is not None]
    return Hoje(
        dia=ctx.hoje,
        dia_semana=recado.dia_semana,
        noite=ctx.hoje_ate_agora,
        vendeu_centavos=int(vendeu or 0),
        noites_iguais=len(com_movimento),
        costuma_mesas=(
            round(sum(r.mesas_atendidas for r in com_movimento) / len(com_movimento))
            if com_movimento
            else None
        ),
        hora_pico=max(set(picos), key=picos.count) if picos else None,
        pendencias=pendencias,
        esperar=recado.frases,
        dicas=recado.dicas,
    )
