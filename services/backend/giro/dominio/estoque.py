"""Contas do estoque sem banco nem API: custo do prato pela ficha técnica, custo médio das
compras, quanto sai do estoque a cada prato vendido e o que a contagem mostrou.

Quantidade sempre na unidade base do ingrediente: grama (g), mililitro (ml) ou unidade (un).
Preço do ingrediente em centavos por quilo, por litro ou por unidade, que é como se compra.

    1 lasanha vendida  ──ficha──►  120 g de massa, 120 g de carne, 100 g de muçarela...
                                   saem do estoque na hora do pedido

    custo da lasanha = 0,120 kg × R$ 18/kg + 0,120 kg × R$ 38/kg + ... + "outros"
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Unidade(StrEnum):
    GRAMA = "g"
    MILILITRO = "ml"
    UNIDADE = "un"


class TipoMovimento(StrEnum):
    COMPRA = "compra"
    VENDA = "venda"  # prato lançado: a ficha tira do estoque
    ESTORNO = "estorno"  # prato cancelado antes de sair da cozinha: volta para o estoque
    PERDA = "perda"
    CONTAGEM = "contagem"  # o que foi contado substitui a conta; a diferença fica registrada
    INICIAL = "inicial"  # o que já tinha quando o ingrediente entrou no estoque


# Lista fechada: o motivo vira número no fim do mês e não abre espaço para dado pessoal.
MOTIVOS_PERDA = ("Venceu", "Estragou", "Caiu ou queimou", "Prato voltou", "Outro")
# Prato cancelado depois do "Pronto": saiu do estoque e não foi vendido.
MOTIVO_PRATO_CANCELADO = "Prato cancelado"


def base_do_preco(unidade: Unidade | str) -> int:
    """Quantas unidades base cabem na unidade do preço (1 kg = 1000 g, 1 L = 1000 ml)."""
    return 1 if Unidade(unidade) == Unidade.UNIDADE else 1000


def custo_de(quantidade: float, unidade: Unidade | str, preco_centavos: float) -> float:
    """Quanto custa `quantidade` (unidade base) de um ingrediente, em centavos."""
    return quantidade * preco_centavos / base_do_preco(unidade)


@dataclass(frozen=True)
class LinhaFicha:
    quantidade: int  # por porção, na unidade base
    unidade: Unidade
    preco_centavos: int | None  # custo médio do ingrediente; None = ainda sem preço


def custo_da_ficha(linhas: list[LinhaFicha], outros_centavos: int | None) -> int | None:
    """Custo de uma porção pela ficha. Sem ficha, ou com ingrediente ainda sem preço, não dá
    para dizer: o prato fica com o custo digitado no cardápio."""
    if not linhas or any(linha.preco_centavos is None for linha in linhas):
        return None
    ingredientes = sum(
        custo_de(linha.quantidade, linha.unidade, linha.preco_centavos or 0) for linha in linhas
    )
    return round(ingredientes + (outros_centavos or 0))


def custo_medio(
    saldo: int,
    preco_atual: int | None,
    quantidade: int,
    valor_centavos: int | None,
    unidade: Unidade | str,
) -> int | None:
    """Preço do ingrediente depois de uma compra: a média do que já tinha com o que chegou,
    pesada pelas quantidades (custo médio ponderado).

    Saldo negativo (a conta passou do que existe) conta como zero. Compra sem valor (a
    cozinha lançou a produção do molho, por exemplo) não muda o preço."""
    if quantidade <= 0 or valor_centavos is None:
        return preco_atual
    base = base_do_preco(unidade)
    tinha = max(saldo, 0)
    if preco_atual is None or tinha == 0:
        return round(valor_centavos * base / quantidade)
    return round((tinha * preco_atual / base + valor_centavos) * base / (tinha + quantidade))


def baixa(ficha: dict[int, int], porcoes: int) -> dict[int, int]:
    """Quanto de cada ingrediente sai do estoque com `porcoes` pratos vendidos."""
    return {insumo: quantidade * porcoes for insumo, quantidade in ficha.items() if quantidade}


@dataclass(frozen=True)
class Diferenca:
    insumo_id: int
    antes: int  # o que a conta dizia
    contado: int

    @property
    def diferenca(self) -> int:
        """Negativa quando tinha menos do que a conta: perda sem registro."""
        return self.contado - self.antes


def diferencas_da_contagem(saldos: dict[int, int], contados: dict[int, int]) -> list[Diferenca]:
    """Compara o contado com a conta, só dos ingredientes que foram contados."""
    return [Diferenca(i, saldos.get(i, 0), contado) for i, contado in sorted(contados.items())]
