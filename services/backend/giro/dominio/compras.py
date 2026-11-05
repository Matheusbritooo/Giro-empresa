"""Previsão do que vai sair e lista de compras, sem banco nem API.

Para cada prato, o GIRO olha as últimas 4 noites do mesmo dia da semana e pega o valor do
meio (mediana): uma sexta de feriado ou uma terça de chuva não puxa a conta. Depois, para
cada ingrediente:

    sai na noite     = pratos previstos × quanto vai na ficha
    sobra na compra  = tem agora − o que ainda sai antes do dia da compra
    precisa          = o que sai nas noites que a compra cobre (até a compra seguinte)
    com folga        = precisa × (1 + folga), arredondado para cima
    comprar          = com folga − sobra, arredondado para cima na embalagem

Exemplo (compra de sexta, que cobre sexta, sábado e domingo): 69 lasanhas × 120 g = 8,3 kg
de massa; com 15% de folga, 9,5 kg; tem 2 kg; faltam 7,5 kg: 8 pacotes de 1 kg.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum
from statistics import median

SEMANAS = 4  # quantas noites iguais entram na conta
HORIZONTE = 7  # quantas noites à frente dizer "até quando dá"
FOLGA_PADRAO = 15  # por cento
DIAS_DE_COMPRA_PADRAO = "1,4"  # terça e sexta (segunda = 0, domingo = 6)


def ler_dias_de_compra(texto: str | None) -> set[int]:
    """ "1,4" vira {terça, sexta}. Texto estragado volta para o padrão."""
    try:
        dias = {int(d) for d in (texto or "").split(",") if d.strip()}
    except ValueError:
        dias = set()
    dias = {d for d in dias if 0 <= d <= 6}
    return dias or ler_dias_de_compra(DIAS_DE_COMPRA_PADRAO)


def mediana_redonda(valores: list[int]) -> int:
    """O valor do meio. No empate entre dois, a média deles com meio para cima (21,5 vira
    22), como se faz de cabeça."""
    if not valores:
        return 0
    return math.floor(median(valores) + 0.5)


def noites_iguais(noite: date, hoje: date | None = None, semanas: int = SEMANAS) -> list[date]:
    """As últimas noites do mesmo dia da semana que já terminaram (antes de `hoje`), da mais
    antiga para a mais recente. A noite de hoje, pela metade, nunca entra na conta."""
    limite = min(hoje or noite, noite)
    noites = []
    dia = noite - timedelta(weeks=1)
    while len(noites) < semanas:
        if dia < limite:
            noites.append(dia)
        dia -= timedelta(weeks=1)
    return sorted(noites)


def previsao(
    vendas: dict[date, int], noite: date, hoje: date | None = None
) -> tuple[int, list[int]]:
    """Quantos pratos a noite deve vender e as vendas das noites que deram a conta (da mais
    antiga para a mais recente). Noite sem venda conta como zero."""
    ultimas = [vendas.get(d, 0) for d in noites_iguais(noite, hoje)]
    return mediana_redonda(ultimas), ultimas


def proxima_compra(hoje: date, dias_de_compra: set[int]) -> date:
    """O dia da próxima compra: hoje, se hoje é dia de compra."""
    for n in range(7):
        dia = hoje + timedelta(days=n)
        if dia.weekday() in dias_de_compra:
            return dia
    return hoje  # sem dia de compra marcado: a conta vale para hoje


def noites_cobertas(compra: date, dias_de_compra: set[int]) -> list[date]:
    """As noites que a compra precisa cobrir: do dia dela até a véspera da compra seguinte."""
    noites = [compra]
    dia = compra + timedelta(days=1)
    while dia.weekday() not in dias_de_compra and len(noites) < 7:
        noites.append(dia)
        dia += timedelta(days=1)
    return noites


def saidas_previstas(
    pratos: dict[int, dict[date, int]], fichas: dict[int, dict[int, int]]
) -> dict[int, dict[date, int]]:
    """{ingrediente: {noite: quanto sai}}, a partir de {prato: {noite: pratos previstos}}."""
    saidas: dict[int, dict[date, int]] = {}
    for prato, por_noite in pratos.items():
        for insumo, por_porcao in fichas.get(prato, {}).items():
            do_insumo = saidas.setdefault(insumo, {})
            for noite, quantos in por_noite.items():
                do_insumo[noite] = do_insumo.get(noite, 0) + quantos * por_porcao
    return saidas


def quando_acaba(saldo: int, saidas: list[tuple[date, int]]) -> date | None:
    """A primeira noite em que o que sai passa do que tem. None se dá para todas."""
    resto = saldo
    for noite, sai in saidas:
        resto -= sai
        if resto < 0 and sai > 0:
            return noite
    return None


class Situacao(StrEnum):
    ZERADO = "zerado"  # a conta diz que não tem
    VAI_FALTAR = "vai_faltar"  # acaba antes de a próxima compra chegar: urgente
    COMPRAR = "comprar"  # dá até a compra, mas precisa entrar nela
    TEM = "tem"  # não precisa comprar agora


@dataclass(frozen=True)
class LinhaDeCompra:
    tem: int
    sai_ate_compra: int  # o que ainda sai antes do dia da compra
    sobra: int  # o que deve sobrar no dia da compra (nunca menos que zero)
    precisa: int  # o que sai nas noites que a compra cobre
    com_folga: int
    falta: int  # zero quando não precisa comprar
    embalagens: int
    quantidade: int  # embalagens × tamanho da embalagem


def linha_de_compra(
    tem: int, sai_ate_compra: int, precisa: int, folga_pct: int, embalagem: int
) -> LinhaDeCompra:
    sobra = max(tem - sai_ate_compra, 0)
    com_folga = math.ceil(precisa * (100 + folga_pct) / 100)
    falta = max(com_folga - sobra, 0)
    embalagens = math.ceil(falta / max(embalagem, 1)) if falta else 0
    return LinhaDeCompra(
        tem,
        sai_ate_compra,
        sobra,
        precisa,
        com_folga,
        falta,
        embalagens,
        embalagens * max(embalagem, 1),
    )


def situacao(linha: LinhaDeCompra, acaba_em: date | None, compra: date) -> Situacao:
    """Vermelho só para o urgente: antes de cada compra quase tudo precisa ser reposto, e isso
    é a lista, não um alarme."""
    if linha.tem <= 0:
        return Situacao.ZERADO
    if acaba_em is not None and acaba_em < compra:
        return Situacao.VAI_FALTAR
    if linha.embalagens > 0:
        return Situacao.COMPRAR
    return Situacao.TEM


def _numero(valor: float) -> str:
    texto = f"{valor:.2f}".rstrip("0").rstrip(".")
    return texto.replace(".", ",")


def texto_quantidade(unidade: str, base: int) -> str:
    """ "3,2 kg", "800 g", "30 L", "300 ml", "12 unidades"."""
    if unidade == "un":
        return f"{base} {'unidade' if base == 1 else 'unidades'}"
    grande = abs(base) >= 1000
    if unidade == "g":
        return f"{_numero(base / 1000)} kg" if grande else f"{base} g"
    return f"{_numero(base / 1000)} L" if grande else f"{base} ml"


def plural(nome: str) -> str:
    """Plural da primeira palavra: "pacote de 1 kg" vira "pacotes de 1 kg", "barril" vira
    "barris"."""
    primeira, _, resto = nome.partition(" ")
    if primeira.endswith("il"):
        primeira = primeira[:-2] + "is"
    elif primeira.endswith(("r", "z")):
        primeira += "es"
    elif primeira.endswith("m"):
        primeira = primeira[:-1] + "ns"
    elif not primeira.endswith("s"):
        primeira += "s"
    return f"{primeira} {resto}".strip()


def texto_compra(
    unidade: str, embalagens: int, embalagem_quantidade: int, embalagem_nome: str | None
) -> str:
    """O que pedir ao fornecedor: "8 pacotes de 1 kg", "1 barril de 30 L" ou "7 kg"."""
    if not embalagem_nome or embalagem_nome.strip().lower() in ("kg", "l", "g", "ml", "un"):
        return texto_quantidade(unidade, embalagens * embalagem_quantidade)
    nome = embalagem_nome.strip()
    return f"{embalagens} {nome if embalagens == 1 else plural(nome)}"
