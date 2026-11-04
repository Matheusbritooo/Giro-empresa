"""Estoque de demonstração da Cantina do Marcos: 18 ingredientes, a ficha técnica dos pratos e
4 semanas de livro do estoque, montadas a partir dos pedidos do histórico.

O jeito da Cantina: compra na terça (para terça, quarta e quinta) e na sexta (para o fim de
semana), conta o estoque na segunda (fechada) e às vezes joga fora tomate que estragou.
A contagem acha um pouco menos do que a conta, mais na muçarela, no filé e no chopp: é a
diferença que a aba de perdas vai mostrar. Sempre os mesmos números (semente fixa).

Só serve para a demonstração.
"""

from __future__ import annotations

import math
import random
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from giro.dominio.estoque import TipoMovimento, base_do_preco, custo_medio
from giro.dominio.indicadores import FUSO, intervalo_da_noite, noite_de
from giro.modelos import (
    FichaTecnica,
    Insumo,
    ItemCardapio,
    ItemPedido,
    MovimentoEstoque,
    Papel,
    Usuario,
)
from giro.servicos.estoque import atualizar_custo_dos_pratos, recalcular_saldos

# nome, unidade, embalagem, nome da embalagem, onde compra, preço (centavos por kg, L ou un)
INSUMOS: list[tuple[str, str, int, str, str, int]] = [
    ("Carne moída", "g", 1000, "kg", "Açougue", 3800),
    ("Peito de frango", "g", 1000, "kg", "Açougue", 2200),
    ("Filé mignon", "g", 1000, "kg", "Açougue", 8900),
    ("Muçarela", "g", 1000, "kg", "Laticínios", 4200),
    ("Parmesão", "g", 500, "peça de 500 g", "Laticínios", 8500),
    ("Mascarpone", "g", 500, "pote de 500 g", "Laticínios", 7000),
    ("Massa de lasanha", "g", 1000, "pacote de 1 kg", "Atacado", 1800),
    ("Espaguete", "g", 1000, "pacote de 1 kg", "Atacado", 1200),
    ("Fettuccine", "g", 500, "pacote de 500 g", "Atacado", 1400),
    ("Molho de tomate", "g", 2000, "lata de 2 kg", "Atacado", 900),
    ("Creme de leite", "ml", 1000, "caixa de 1 L", "Atacado", 1600),
    ("Batata", "g", 5000, "saco de 5 kg", "Hortifrúti", 600),
    ("Tomate", "g", 1000, "kg", "Hortifrúti", 800),
    ("Refrigerante lata", "un", 12, "fardo de 12", "Bebidas", 260),
    ("Cerveja long neck", "un", 24, "caixa de 24", "Bebidas", 480),
    ("Chopp", "ml", 30000, "barril de 30 L", "Bebidas", 1333),
    ("Vinho da casa", "ml", 750, "garrafa", "Bebidas", 3733),
    ("Água sem gás", "un", 12, "fardo de 12", "Bebidas", 120),
]  # fmt: skip
INSUMOS_POR_NOME = {linha[0]: linha for linha in INSUMOS}

# prato: ([(ingrediente, quantidade por porção)], "outros" em centavos). Ravioli, pão de alho,
# carpaccio, pudim, petit gâteau, suco e café ficam sem ficha: o custo continua o digitado.
FICHAS: dict[str, tuple[list[tuple[str, int]], int]] = {
    "Lasanha à bolonhesa": (
        [
            ("Massa de lasanha", 120),
            ("Carne moída", 120),
            ("Molho de tomate", 150),
            ("Muçarela", 100),
            ("Parmesão", 15),
        ],
        350,
    ),
    "Parmegiana de frango": (
        [("Peito de frango", 200), ("Muçarela", 100), ("Molho de tomate", 120), ("Batata", 200)],
        710,
    ),
    "Espaguete ao sugo": (
        [("Espaguete", 150), ("Molho de tomate", 200), ("Parmesão", 20), ("Tomate", 100)],
        390,
    ),
    "Nhoque da casa": (
        [("Batata", 300), ("Molho de tomate", 180), ("Parmesão", 20)],
        590,
    ),
    "Filé à parmegiana": (
        [("Filé mignon", 200), ("Muçarela", 100), ("Molho de tomate", 120), ("Batata", 200)],
        370,
    ),
    "Fettuccine Alfredo": (
        [("Fettuccine", 150), ("Creme de leite", 200), ("Parmesão", 40)],
        860,
    ),
    "Polpettone recheado": (
        [("Carne moída", 220), ("Muçarela", 80), ("Molho de tomate", 150), ("Batata", 200)],
        570,
    ),
    "Tiramisù": (
        [("Mascarpone", 60)],
        280,
    ),
    "Bruschetta de tomate": (
        [("Tomate", 120)],
        600,
    ),
    "Refrigerante lata": (
        [("Refrigerante lata", 1)],
        0,
    ),
    "Cerveja long neck": (
        [("Cerveja long neck", 1)],
        0,
    ),
    "Chopp 300 ml": (
        [("Chopp", 300)],
        0,
    ),
    "Vinho da casa (taça)": (
        [("Vinho da casa", 150)],
        0,
    ),
    "Vinho da casa (garrafa)": (
        [("Vinho da casa", 750)],
        0,
    ),
    "Água sem gás": (
        [("Água sem gás", 1)],
        0,
    ),
}

TERCA, SEXTA, SEGUNDA = 1, 4, 0
FOLGA = 0.15
# O que a contagem de segunda acha a menos que a conta, em parte do que saiu na semana.
SUMICO = {
    "Muçarela": (0.06, 0.09),  # porção maior que a ficha
    "Filé mignon": (0.08, 0.11),  # a peça perde na limpeza
    "Chopp": (0.10, 0.15),  # espuma e limpeza da chopeira
    "Carne moída": (0.04, 0.07),
    "Vinho da casa": (0.03, 0.06),
    "Parmesão": (0.05, 0.08),
}
SUMICO_PADRAO = (0.0, 0.02)
# Na última compra antes de hoje, comprou pouco destes: o estoque mostra o que está acabando.
COMPROU_POUCO = {"Massa de lasanha", "Muçarela", "Mascarpone"}


def criar_estoque(db: Session, restaurante_id: int) -> dict[str, Insumo]:
    """Cria os ingredientes e as fichas se o restaurante ainda não tem nenhum ingrediente."""
    existentes = {
        i.nome: i for i in db.scalars(select(Insumo).where(Insumo.restaurante_id == restaurante_id))
    }
    if existentes:
        return existentes
    insumos = {}
    for nome, unidade, embalagem, nome_embalagem, onde, preco in INSUMOS:
        insumo = Insumo(
            restaurante_id=restaurante_id,
            nome=nome,
            unidade=unidade,
            embalagem_quantidade=embalagem,
            embalagem_nome=nome_embalagem,
            onde_compra=onde,
            custo_centavos=preco,
        )
        db.add(insumo)
        insumos[nome] = insumo
    db.flush()
    itens = {
        i.nome: i
        for i in db.scalars(
            select(ItemCardapio).where(ItemCardapio.restaurante_id == restaurante_id)
        )
    }
    for prato, (linhas, outros) in FICHAS.items():
        item = itens.get(prato)
        if item is None:
            continue
        item.custo_outros_centavos = outros
        for nome, quantidade in linhas:
            db.add(
                FichaTecnica(
                    restaurante_id=restaurante_id,
                    item_id=item.id,
                    insumo_id=insumos[nome].id,
                    quantidade=quantidade,
                )
            )
    db.flush()
    atualizar_custo_dos_pratos(db, restaurante_id, insumos={i.id for i in insumos.values()})
    return insumos


def _consumo_por_noite(
    db: Session, restaurante_id: int, antes_de: datetime
) -> dict[date, dict[int, int]]:
    """Quanto de cada ingrediente saiu em cada noite, pelos pedidos e pelas fichas."""
    fichas: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for item_id, insumo_id, quantidade in db.execute(
        select(FichaTecnica.item_id, FichaTecnica.insumo_id, FichaTecnica.quantidade).where(
            FichaTecnica.restaurante_id == restaurante_id
        )
    ):
        fichas[item_id].append((insumo_id, quantidade))
    consumo: dict[date, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for item_id, quantidade, lancado in db.execute(
        select(ItemPedido.item_id, ItemPedido.quantidade, ItemPedido.lancado_em).where(
            ItemPedido.restaurante_id == restaurante_id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em < antes_de,
        )
    ):
        noite = noite_de(lancado)
        for insumo_id, por_porcao in fichas.get(item_id, []):
            consumo[noite][insumo_id] += quantidade * por_porcao
    return consumo


def _quem(db: Session, restaurante_id: int, papel: Papel) -> int | None:
    return db.scalar(
        select(Usuario.id)
        .where(Usuario.restaurante_id == restaurante_id, Usuario.papel == papel.value)
        .order_by(Usuario.id)
        .limit(1)
    )


def gerar_estoque(db: Session, restaurante_id: int, hoje: date, semente: int = 11) -> int:
    """Monta o livro do estoque das noites passadas, se ainda não houver. Devolve quantas
    linhas criou. Precisa dos pedidos do histórico já no banco."""
    inicio_de_hoje, _ = intervalo_da_noite(hoje)
    insumos = criar_estoque(db, restaurante_id)
    ja_tem = db.scalar(
        select(MovimentoEstoque.id)
        .where(
            MovimentoEstoque.restaurante_id == restaurante_id,
            MovimentoEstoque.em < inicio_de_hoje,
        )
        .limit(1)
    )
    consumo = _consumo_por_noite(db, restaurante_id, inicio_de_hoje)
    if ja_tem is not None or not consumo:
        return 0

    sorteio = random.Random(semente)  # noqa: S311 (dado de demonstração, não é segredo)
    gerente = _quem(db, restaurante_id, Papel.GERENTE)
    equipe = _quem(db, restaurante_id, Papel.EQUIPE)
    por_id = {i.id: i for i in insumos.values()}
    saldo = dict.fromkeys(por_id, 0)
    preco = {i.id: i.custo_centavos for i in por_id.values()}
    linhas: list[dict] = []

    def anotar(insumo_id, tipo, quantidade, quando, **extra) -> None:
        saldo[insumo_id] += quantidade
        linhas.append(
            {
                "restaurante_id": restaurante_id,
                "insumo_id": insumo_id,
                "tipo": tipo.value,
                "quantidade": quantidade,
                "saldo_depois": saldo[insumo_id],
                "em": quando,
                "valor_centavos": extra.get("valor"),
                "motivo": extra.get("motivo"),
                "usuario_id": extra.get("usuario"),
            }
        )

    def comprar(insumo: Insumo, quantidade: int, quando: datetime) -> None:
        embalagens = math.ceil(quantidade / insumo.embalagem_quantidade)
        if embalagens <= 0:
            return
        quanto = embalagens * insumo.embalagem_quantidade
        unitario = INSUMOS_POR_NOME[insumo.nome][5] * (1 + sorteio.uniform(-0.03, 0.06))
        valor = round(quanto * unitario / base_do_preco(insumo.unidade))
        preco[insumo.id] = custo_medio(
            saldo[insumo.id], preco[insumo.id], quanto, valor, insumo.unidade
        )
        anotar(insumo.id, TipoMovimento.COMPRA, quanto, quando, valor=valor, usuario=gerente)

    def previsto(noite: date, insumo_id: int) -> int:
        """O que a noite vai gastar: a de verdade se já passou, senão a da semana anterior."""
        while noite >= hoje:
            noite -= timedelta(days=7)
        return consumo.get(noite, {}).get(insumo_id, 0)

    primeira = min(consumo)
    ultima_compra = max(
        (
            d
            for d in (hoje - timedelta(days=n) for n in range(1, 8))
            if d.weekday() in (TERCA, SEXTA) and d >= primeira
        ),
        default=None,
    )
    dia = primeira
    while dia < hoje:
        manha = datetime.combine(dia, time(10), FUSO)
        semana_passada = [dia - timedelta(days=n) for n in range(1, 8)]
        if dia == primeira:  # o estoque que já tinha quando o GIRO começou a contar
            for insumo_id in por_id:
                tinha = sum(previsto(dia + timedelta(days=n), insumo_id) for n in range(3))
                anotar(
                    insumo_id, TipoMovimento.CONTAGEM, round(tinha * 1.2), manha, usuario=gerente
                )
        if dia.weekday() == SEGUNDA:  # fechado: dia de contar
            for insumo_id, insumo in por_id.items():
                saiu = sum(consumo.get(d, {}).get(insumo_id, 0) for d in semana_passada)
                faixa = SUMICO.get(insumo.nome, SUMICO_PADRAO)
                sumiu = min(round(saiu * sorteio.uniform(*faixa)), saldo[insumo_id])
                anotar(insumo_id, TipoMovimento.CONTAGEM, -sumiu, manha, usuario=gerente)
        if dia.weekday() in (TERCA, SEXTA):
            ciclo = [dia + timedelta(days=n) for n in range(3)]
            for insumo_id, insumo in por_id.items():
                precisa = sum(previsto(n, insumo_id) for n in ciclo) * (1 + FOLGA)
                if dia == ultima_compra and insumo.nome in COMPROU_POUCO:
                    precisa *= 0.7
                comprar(insumo, round(precisa - saldo[insumo_id]), manha)
        # Perdas registradas pela equipe.
        tarde = datetime.combine(dia, time(16), FUSO)
        perdas = []
        if dia.weekday() == 3 and sorteio.random() < 0.8:
            perdas.append(("Tomate", sorteio.choice((1000, 1500, 2000)), "Estragou"))
        if dia.weekday() == 5 and sorteio.random() < 0.4:
            perdas.append(("Creme de leite", 1000, "Venceu"))
        if dia.weekday() == SEXTA and sorteio.random() < 0.5:
            perdas.append(("Muçarela", 300, "Caiu ou queimou"))
        for nome, quanto, motivo in perdas:
            insumo_id = insumos[nome].id
            quanto = min(quanto, saldo[insumo_id])
            if quanto > 0:
                anotar(
                    insumo_id, TipoMovimento.PERDA, -quanto, tarde, motivo=motivo, usuario=equipe
                )
        # A noite: compra de última hora se não der, depois sai o que foi vendido.
        gasto = consumo.get(dia, {})
        fim = datetime.combine(dia, time(23, 45), FUSO)
        for insumo_id, quanto in sorted(gasto.items()):
            if quanto > saldo[insumo_id]:
                comprar(por_id[insumo_id], quanto - saldo[insumo_id], tarde)
            anotar(insumo_id, TipoMovimento.VENDA, -quanto, fim)
        dia += timedelta(days=1)

    if linhas:
        db.execute(insert(MovimentoEstoque), linhas)
    for insumo_id, insumo in por_id.items():
        insumo.custo_centavos = preco[insumo_id]
    db.flush()
    recalcular_saldos(db, restaurante_id)  # inclui o que já foi lançado hoje
    atualizar_custo_dos_pratos(db, restaurante_id, insumos=set(por_id))
    return len(linhas)
