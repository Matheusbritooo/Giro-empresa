"""O relatório do mês: o resumo que o dono manda para o contador ou para o sócio.

Mês do calendário, noite a noite (a noite vai das 6h às 6h, como em todo o GIRO). Reaproveita
as contas dos resultados, das vendas e das perdas; não tem regra nova, só junta tudo num lugar
e compara com o mês anterior. A parte de custo (CMV, compras, o que escapou) só vai para quem
vê custo.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from giro.dominio.estoque import TipoMovimento
from giro.dominio.indicadores import (
    Indicadores,
    NotasDosClientes,
    intervalo_da_noite,
    noite_de,
)
from giro.modelos import ItemPedido, MovimentoEstoque, Ocupacao, Restaurante
from giro.servicos import resultados as servico_resultados
from giro.servicos.perdas import PerdaPorMotivo, relatorio_de_perdas

PRATOS = 10  # quantos itens entram no "mais vendidos"


@dataclass
class NoiteDoMes:
    dia: date
    mesas_atendidas: int
    pessoas: int
    desistencias: int
    vendeu_centavos: int
    ficou_na_mesa_centavos: int
    espera_media_seg: float | None
    parada_media_seg: float | None
    nota_media: float | None


@dataclass
class ItemDoMes:
    nome: str
    quantidade: int
    receita_centavos: int


@dataclass
class CustoDoMes:
    """Só para quem vê custo (o dono)."""

    custo_pela_ficha_centavos: int
    escapou_centavos: int
    compras_centavos: int  # soma das notas de compra lançadas no mês
    itens_sem_custo: list[str]
    por_motivo: list[PerdaPorMotivo]


@dataclass
class Relatorio:
    mes: date  # o dia 1 do mês
    primeira_noite: date
    ultima_noite: date  # o último dia do mês, ou hoje se o mês ainda não acabou
    completo: bool  # o mês já terminou
    atual: Indicadores
    anterior: Indicadores  # o trecho do mês anterior que se compara (veja `comparacao`)
    vendeu_centavos: int
    vendeu_antes_centavos: int
    notas: NotasDosClientes
    noites: list[NoiteDoMes]
    pratos: list[ItemDoMes]
    custo: CustoDoMes | None = None
    noites_com_movimento: int = 0
    pessoas: int = 0
    semanas: list[tuple[date, date, int, int]] = field(default_factory=list)
    # Com o que se compara: o mês anterior inteiro (mês fechado), o mesmo trecho dele (mês em
    # andamento: do dia 1 até o mesmo dia e hora) ou nada, quando o GIRO ainda não estava em
    # uso no começo do mês anterior (a comparação mostraria um salto que não aconteceu).
    comparacao: tuple[date, date] | None = None


def primeiro_dia(mes: date) -> date:
    return mes.replace(day=1)


def mes_anterior(mes: date) -> date:
    return (primeiro_dia(mes) - timedelta(days=1)).replace(day=1)


def ultimo_dia(mes: date) -> date:
    proximo = (primeiro_dia(mes) + timedelta(days=32)).replace(day=1)
    return proximo - timedelta(days=1)


def intervalo_do_mes(mes: date) -> tuple[datetime, datetime]:
    """Da abertura da noite do dia 1 até o fim da noite do último dia (6h do dia seguinte)."""
    inicio, _ = intervalo_da_noite(primeiro_dia(mes))
    _, fim = intervalo_da_noite(ultimo_dia(mes))
    return inicio, fim


def _em_uso_desde(db: Session, restaurante_id: int) -> datetime | None:
    """A primeira visita registrada: antes disso o GIRO não via o salão."""
    return db.scalar(
        select(func.min(Ocupacao.sentou_em)).where(Ocupacao.restaurante_id == restaurante_id)
    )


def janela_de_comparacao(
    mes: date, agora: datetime, em_uso_desde: datetime | None
) -> tuple[datetime, datetime] | None:
    """O trecho do mês anterior que se compara com o mês: inteiro, se o mês já acabou; senão,
    o mesmo tempo desde o começo dele (dia 1 às 6h até o mesmo dia e hora), sem passar do fim.
    Nada quando o GIRO não estava em uso desde o começo do mês anterior."""
    inicio, fim = intervalo_do_mes(mes)
    antes_inicio, antes_fim = intervalo_do_mes(mes_anterior(mes))
    if em_uso_desde is None or em_uso_desde >= antes_inicio:
        return None
    if agora >= fim:
        return antes_inicio, antes_fim
    return antes_inicio, min(antes_inicio + (agora - inicio), antes_fim)


def _vendas_por_noite(
    db: Session, restaurante_id: int, inicio: datetime, fim: datetime
) -> dict[date, int]:
    vendas: dict[date, int] = defaultdict(int)
    for lancado, valor in db.execute(
        select(ItemPedido.lancado_em, ItemPedido.quantidade * ItemPedido.preco_unit_centavos).where(
            ItemPedido.restaurante_id == restaurante_id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= inicio,
            ItemPedido.lancado_em < fim,
        )
    ):
        vendas[noite_de(lancado)] += int(valor)
    return vendas


def _notas_por_noite(
    db: Session, restaurante_id: int, inicio: datetime, fim: datetime
) -> dict[date, list[int]]:
    notas: dict[date, list[int]] = defaultdict(list)
    for nota, sentou in db.execute(
        select(Ocupacao.nota, Ocupacao.sentou_em).where(
            Ocupacao.restaurante_id == restaurante_id,
            Ocupacao.sentou_em >= inicio,
            Ocupacao.sentou_em < fim,
            Ocupacao.nota.is_not(None),
        )
    ):
        notas[noite_de(sentou)].append(nota)
    return notas


def _pratos(db: Session, restaurante_id: int, inicio: datetime, fim: datetime) -> list[ItemDoMes]:
    quantidade = func.sum(ItemPedido.quantidade)
    receita = func.sum(ItemPedido.quantidade * ItemPedido.preco_unit_centavos)
    linhas = db.execute(
        select(ItemPedido.nome, quantidade, receita)
        .where(
            ItemPedido.restaurante_id == restaurante_id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= inicio,
            ItemPedido.lancado_em < fim,
        )
        .group_by(ItemPedido.nome)
        .order_by(quantidade.desc(), ItemPedido.nome)
        .limit(PRATOS)
    ).all()
    return [ItemDoMes(nome, int(q), int(r)) for nome, q, r in linhas]


def _compras(db: Session, restaurante_id: int, inicio: datetime, fim: datetime) -> int:
    total = db.scalar(
        select(func.sum(MovimentoEstoque.valor_centavos)).where(
            MovimentoEstoque.restaurante_id == restaurante_id,
            MovimentoEstoque.tipo == TipoMovimento.COMPRA.value,
            MovimentoEstoque.em >= inicio,
            MovimentoEstoque.em < fim,
        )
    )
    return int(total or 0)


def relatorio_do_mes(
    db: Session, restaurante: Restaurante, mes: date, agora: datetime, com_custo: bool
) -> Relatorio:
    mes = primeiro_dia(mes)
    inicio, fim = intervalo_do_mes(mes)
    antes_inicio, antes_fim = intervalo_do_mes(mes_anterior(mes))
    hoje = noite_de(agora)
    ultima = min(ultimo_dia(mes), hoje)
    fim_ate_agora = min(fim, agora)

    janela = janela_de_comparacao(mes, agora, _em_uso_desde(db, restaurante.id))
    antes_ate = janela[1] if janela else antes_inicio

    dados = servico_resultados.carregar(db, restaurante, antes_inicio, fim, agora)
    atual = dados.indicadores(inicio, fim_ate_agora)
    anterior = dados.indicadores(antes_inicio, antes_ate)

    vendas = _vendas_por_noite(db, restaurante.id, inicio, fim_ate_agora)
    vendas_antes = _vendas_por_noite(db, restaurante.id, antes_inicio, antes_ate)
    notas_noite = _notas_por_noite(db, restaurante.id, inicio, fim_ate_agora)

    noites: list[NoiteDoMes] = []
    dia = mes
    while dia <= ultima:
        de, ate = intervalo_da_noite(dia)
        r = dados.indicadores(de, min(ate, agora))
        notas = notas_noite.get(dia, [])
        noites.append(
            NoiteDoMes(
                dia=dia,
                mesas_atendidas=r.mesas_atendidas,
                pessoas=r.pessoas_atendidas,
                desistencias=r.desistencias,
                vendeu_centavos=vendas.get(dia, 0),
                ficou_na_mesa_centavos=r.perdido_total_centavos,
                espera_media_seg=r.espera_media_seg,
                parada_media_seg=r.parada_media_seg,
                nota_media=sum(notas) / len(notas) if notas else None,
            )
        )
        dia += timedelta(days=1)

    # Semanas de segunda a domingo, cortadas no mês: (de, até, mesas atendidas, vendeu).
    semanas: list[tuple[date, date, int, int]] = []
    for noite in noites:
        if not semanas or noite.dia.weekday() == 0:
            semanas.append((noite.dia, noite.dia, 0, 0))
        de, _, mesas, vendeu = semanas[-1]
        semanas[-1] = (de, noite.dia, mesas + noite.mesas_atendidas, vendeu + noite.vendeu_centavos)

    custo = None
    if com_custo:
        dias = (ultima - mes).days + 1
        perdas = relatorio_de_perdas(
            db, restaurante, servico_resultados.Periodo.MES, agora, janela=(inicio, fim, dias)
        )
        custo = CustoDoMes(
            custo_pela_ficha_centavos=perdas.custo_pela_ficha_centavos,
            escapou_centavos=perdas.escapou_centavos,
            compras_centavos=_compras(db, restaurante.id, inicio, fim_ate_agora),
            itens_sem_custo=perdas.itens_sem_custo,
            por_motivo=perdas.por_motivo,
        )

    return Relatorio(
        mes=mes,
        primeira_noite=mes,
        ultima_noite=ultima,
        completo=hoje > ultimo_dia(mes),
        atual=atual,
        anterior=anterior,
        vendeu_centavos=sum(vendas.values()),
        vendeu_antes_centavos=sum(vendas_antes.values()),
        notas=servico_resultados.notas_do_periodo(db, restaurante, inicio, fim_ate_agora),
        noites=noites,
        pratos=_pratos(db, restaurante.id, inicio, fim_ate_agora),
        custo=custo,
        noites_com_movimento=sum(1 for n in noites if n.mesas_atendidas or n.vendeu_centavos),
        pessoas=atual.pessoas_atendidas,
        semanas=semanas,
        comparacao=(
            (noite_de(antes_inicio), noite_de(antes_ate - timedelta(seconds=1))) if janela else None
        ),
    )
