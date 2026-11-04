"""Contas do cardápio sem banco nem API: a matriz de lucro dos pratos, o que combina com o
quê, o tempo de cozinha de cada item e em quanto tempo a mesa vaga depois de pedir a conta.

Matriz de lucro (engenharia de cardápio de Kasavana e Smith), sempre dentro de uma categoria:

    vende muito │ BURRO DE CARGA      │ ESTRELA
                │ (subir o preço ou   │ (manter e destacar)
                │  baratear a receita)│
    ────────────┼─────────────────────┼────────────────────
    vende pouco │ CÃO                 │ QUEBRA-CABEÇA
                │ (pensar em tirar)   │ (o garçom indicar)
                     lucra pouco           lucra bem

Vende muito: a fatia do prato nas vendas da categoria passa de 70% da fatia que cada um
teria se todos vendessem igual. Lucra bem: o lucro por unidade (preço pago menos custo)
passa da média da categoria, ponderada pelas vendas.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import StrEnum
from statistics import median

CORTE_POPULARIDADE = 0.7
# Sem histórico suficiente, a conta costuma sair em uns 10 minutos.
MINUTOS_ATE_VAGAR_PADRAO = 10
MINIMO_AMOSTRAS = 5
MINIMO_AMOSTRAS_TEMPO = 3


class Quadrante(StrEnum):
    ESTRELA = "estrela"
    BURRO_DE_CARGA = "burro_de_carga"
    QUEBRA_CABECA = "quebra_cabeca"
    CAO = "cao"


@dataclass(frozen=True)
class Venda:
    item_id: int
    nome: str
    quantidade: int
    receita_centavos: int
    custo_centavos: int | None  # custo de uma unidade; sem custo, o prato fica fora


@dataclass(frozen=True)
class ItemMatriz:
    item_id: int
    nome: str
    quantidade: int
    lucro_unidade_centavos: int
    quadrante: Quadrante


@dataclass(frozen=True)
class Matriz:
    itens: list[ItemMatriz]
    lucro_medio_centavos: int
    sem_custo: list[str]  # vendidos, mas sem custo informado: ficam fora da conta


def matriz_de_lucro(vendas: list[Venda]) -> Matriz | None:
    """A matriz de uma categoria. Precisa de pelo menos 2 pratos vendidos com custo."""
    vendidas = [v for v in vendas if v.quantidade > 0]
    com_custo = [v for v in vendidas if v.custo_centavos is not None]
    if len(com_custo) < 2:
        return None
    total = sum(v.quantidade for v in com_custo)
    lucro = {
        v.item_id: round(v.receita_centavos / v.quantidade) - (v.custo_centavos or 0)
        for v in com_custo
    }
    lucro_medio = round(sum(lucro[v.item_id] * v.quantidade for v in com_custo) / total)
    corte = CORTE_POPULARIDADE / len(com_custo)

    itens = []
    for v in com_custo:
        popular = v.quantidade / total >= corte
        lucra = lucro[v.item_id] >= lucro_medio
        if popular:
            quadrante = Quadrante.ESTRELA if lucra else Quadrante.BURRO_DE_CARGA
        else:
            quadrante = Quadrante.QUEBRA_CABECA if lucra else Quadrante.CAO
        itens.append(ItemMatriz(v.item_id, v.nome, v.quantidade, lucro[v.item_id], quadrante))
    itens.sort(key=lambda i: (-i.quantidade, i.nome))
    return Matriz(itens, lucro_medio, sorted(v.nome for v in vendidas if v.custo_centavos is None))


def combinacoes(visitas: list[set[int]], alvo: int, candidatos: set[int], limite: int = 3):
    """Das visitas que pediram `alvo`, quantas (de 0 a 1) também pediram cada candidato.

    Devolve [(item, fração)] do mais comum para o menos comum."""
    com_alvo = [v for v in visitas if alvo in v]
    if not com_alvo:
        return []
    conta = Counter(i for v in com_alvo for i in v if i in candidatos and i != alvo)
    return [(item, n / len(com_alvo)) for item, n in conta.most_common(limite)]


@dataclass(frozen=True)
class TempoDePreparo:
    minutos: float
    minutos_fim_de_semana: float | None  # sexta e sábado, quando o salão enche
    minutos_semana: float | None
    amostras: int


def tempo_de_preparo(amostras: list[tuple[float, bool]]) -> TempoDePreparo | None:
    """Mediana dos minutos entre lançar e ficar pronto. Cada amostra: (minutos, fim de
    semana?). Com poucas amostras, não dá para dizer nada."""
    validas = [(m, fds) for m, fds in amostras if 0 <= m < 180]
    if len(validas) < MINIMO_AMOSTRAS_TEMPO:
        return None

    def mediana(lista: list[float]) -> float | None:
        return round(median(lista), 1) if len(lista) >= MINIMO_AMOSTRAS_TEMPO else None

    return TempoDePreparo(
        minutos=round(median(m for m, _ in validas), 1),
        minutos_fim_de_semana=mediana([m for m, fds in validas if fds]),
        minutos_semana=mediana([m for m, fds in validas if not fds]),
        amostras=len(validas),
    )


def minutos_ate_vagar(amostras: list[float]) -> int:
    """Em quantos minutos a mesa costuma esvaziar depois de pedir a conta (mediana)."""
    validas = [m for m in amostras if 0 < m < 60]
    if len(validas) < MINIMO_AMOSTRAS:
        return MINUTOS_ATE_VAGAR_PADRAO
    return max(1, round(median(validas)))
