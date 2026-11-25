"""A planilha de vendas do caixa do restaurante, sem banco nem API.

O caixa (o sistema que emite a nota) é o valor oficial de venda. Importar a planilha dele serve
para conferir com o que foi lançado no GIRO: o que o caixa vendeu e ninguém lançou como pedido
é venda que o GIRO não viu (e o estoque não baixou).

Cada sistema de caixa exporta de um jeito. Aqui se acha sozinho:
- o separador (ponto e vírgula, vírgula ou tabulação);
- as colunas pelo nome do cabeçalho: data (e hora, se vier separada), produto, quantidade e
  valor total da linha (ou o unitário, que vira total com a quantidade);
- datas "24/11/2026", "24/11/2026 21:40" ou "2026-11-24 21:40:00";
- valores "1.234,56", "1234,56", "1234.56" ou "R$ 12,50".

Só essas quatro coisas são lidas. Qualquer outra coluna (nome do cliente, CPF, mesa, garçom,
forma de pagamento) é ignorada e nunca guardada. O arquivo também não é guardado.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime

from giro.dominio.indicadores import FUSO, noite_de

MAXIMO_LINHAS = 50_000


class ErroPlanilha(ValueError):
    """Planilha que não dá para ler, com a explicação para o dono."""


@dataclass(frozen=True)
class LinhaCaixa:
    noite: date
    nome: str
    quantidade: int
    valor_centavos: int


@dataclass
class Leitura:
    linhas: list[LinhaCaixa]
    ignoradas: int  # linhas sem produto, sem valor ou com data que não deu para ler
    colunas: dict[str, str]  # o que virou o quê: {"data": "Data emissão", ...}
    avisos: list[str] = field(default_factory=list)


def normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFD", texto)
    sem_acento = "".join(c for c in sem_acento if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", sem_acento.lower())).strip()


# Nomes de coluna que cada sistema usa (já sem acento e em minúsculas), do mais certo ao menos.
COLUNAS = {
    "data": ["data hora", "data emissao", "data venda", "data", "dia", "emissao", "dt"],
    "hora": ["hora", "horario"],
    "nome": ["produto", "descricao produto", "descricao", "item", "nome produto", "nome"],
    "quantidade": ["quantidade", "qtde", "qtd", "quant", "qt"],
    "total": ["valor total", "total item", "vl total", "total", "valor liquido", "valor"],
    "unitario": ["valor unitario", "valor unit", "preco unitario", "vl unit", "unitario", "preco"],
}


def _achar_colunas(cabecalho: list[str]) -> dict[str, int]:
    """Primeiro os nomes iguais, depois os que começam com um nome conhecido ("Data emissão
    NF"). Coluna de valor unitário nunca vira o total, nem o contrário."""
    nomes = [normalizar(c) for c in cabecalho]

    def serve(papel: str, nome: str, candidato: str, exato: bool) -> bool:
        if papel == "total" and "unit" in nome:
            return False
        if exato:
            return nome == candidato
        return nome.startswith(candidato + " ") or (" " in candidato and nome.startswith(candidato))

    achadas: dict[str, int] = {}
    for exato in (True, False):
        for papel, candidatos in COLUNAS.items():
            if papel in achadas:
                continue
            for candidato in candidatos:
                livre = (
                    i
                    for i, nome in enumerate(nomes)
                    if i not in achadas.values() and serve(papel, nome, candidato, exato)
                )
                if (i := next(livre, None)) is not None:
                    achadas[papel] = i
                    break
    return achadas


def _separador(primeira: str) -> str:
    contagem = {s: primeira.count(s) for s in (";", "\t", ",")}
    return max(contagem, key=lambda s: contagem[s]) if any(contagem.values()) else ";"


def ler_dinheiro(texto: str) -> int | None:
    """ "1.234,56" / "1234,56" / "1234.56" / "R$ 12,50" / "-3,00" em centavos."""
    limpo = re.sub(r"[^\d,.\-]", "", texto.strip())
    if not limpo or not re.search(r"\d", limpo):
        return None
    if "," in limpo and "." in limpo:
        if limpo.rfind(",") > limpo.rfind("."):
            limpo = limpo.replace(".", "").replace(",", ".")
        else:
            limpo = limpo.replace(",", "")
    elif "," in limpo:
        limpo = limpo.replace(".", "").replace(",", ".")
    elif limpo.count(".") > 1:
        limpo = limpo.replace(".", "")
    try:
        return round(float(limpo) * 100)
    except ValueError:
        return None


def ler_quantidade(texto: str) -> int | None:
    valor = ler_dinheiro(texto)
    if valor is None:
        return None
    return max(round(valor / 100), 0)


def ler_momento(data: str, hora: str = "") -> datetime | date | None:
    """Data com hora vira o instante (para achar a noite); só data vira o próprio dia."""
    texto = f"{data.strip()} {hora.strip()}".strip()
    for formato in (
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%d/%m/%y %H:%M",
    ):
        try:
            return datetime.strptime(texto, formato).replace(tzinfo=FUSO)
        except ValueError:
            pass
    for formato in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%Y"):
        try:
            return datetime.strptime(data.strip(), formato).date()
        except ValueError:
            pass
    return None


def ler_planilha(texto: str) -> Leitura:
    texto = texto.lstrip("﻿")
    primeira = next((linha for linha in texto.splitlines() if linha.strip()), "")
    if not primeira:
        raise ErroPlanilha("A planilha está vazia.")
    leitor = csv.reader(io.StringIO(texto), delimiter=_separador(primeira))
    linhas = [linha for linha in leitor if any(c.strip() for c in linha)]
    if len(linhas) > MAXIMO_LINHAS:
        raise ErroPlanilha(
            f"A planilha tem mais de {MAXIMO_LINHAS} linhas: exporte um mês por vez."
        )
    cabecalho, corpo = linhas[0], linhas[1:]
    colunas = _achar_colunas(cabecalho)
    faltam = [
        rotulo for papel, rotulo in (("data", "data"), ("nome", "produto")) if papel not in colunas
    ]
    if "total" not in colunas and "unitario" not in colunas:
        faltam.append("valor")
    if faltam:
        raise ErroPlanilha(
            f"Não achei a coluna de {' e de '.join(faltam)}. A primeira linha da planilha "
            "precisa ter o nome das colunas (por exemplo: Data, Produto, Quantidade, Total)."
        )

    def celula(linha: list[str], papel: str) -> str:
        i = colunas.get(papel)
        return linha[i] if i is not None and i < len(linha) else ""

    lidas: list[LinhaCaixa] = []
    ignoradas = sem_hora = 0
    for linha in corpo:
        nome = celula(linha, "nome").strip()
        momento = ler_momento(celula(linha, "data"), celula(linha, "hora"))
        quantidade = ler_quantidade(celula(linha, "quantidade")) if "quantidade" in colunas else 1
        if "total" in colunas:
            valor = ler_dinheiro(celula(linha, "total"))
        else:
            unitario = ler_dinheiro(celula(linha, "unitario"))
            valor = None if unitario is None or quantidade is None else unitario * quantidade
        if not nome or momento is None or valor is None or quantidade is None:
            ignoradas += 1
            continue
        if isinstance(momento, datetime):
            noite = noite_de(momento)
        else:
            noite, sem_hora = momento, sem_hora + 1
        lidas.append(LinhaCaixa(noite, nome[:120], quantidade, valor))

    avisos = []
    if "quantidade" not in colunas:
        avisos.append("Sem coluna de quantidade: cada linha contou como 1.")
    if lidas and sem_hora == len(lidas):
        avisos.append("A planilha não tem hora: cada venda foi para a noite do dia da data.")
    return Leitura(
        linhas=lidas,
        ignoradas=ignoradas,
        colunas={papel: cabecalho[i] for papel, i in colunas.items()},
        avisos=avisos,
    )


def sugerir_item(nome: str, itens: Iterable[tuple[int, str]]) -> int | None:
    """O item do cardápio que mais parece o nome do caixa: igual sem acento, ou com pelo menos
    metade das palavras em comum. Sem nada parecido, None (o dono escolhe)."""
    alvo = normalizar(nome)
    palavras = set(alvo.split())
    melhor, nota = None, 0.0
    for item_id, nome_item in itens:
        candidato = normalizar(nome_item)
        if candidato == alvo:
            return item_id
        outras = set(candidato.split())
        if not palavras or not outras:
            continue
        comum = len(palavras & outras) / len(palavras | outras)
        if comum > nota:
            melhor, nota = item_id, comum
    return melhor if nota >= 0.5 else None
