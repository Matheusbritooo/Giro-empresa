"""Cardápio de demonstração da Cantina do Marcos e os pedidos de cada visita do histórico.

Os 22 itens são os da proposta aprovada (cantina italiana de bairro, perto de R$ 85 por
pessoa). O "peso" diz o quanto cada item sai: a lasanha é o prato da casa, o polpettone
lucra bem mas pouca gente pede. Só serve para a demonstração.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.dominio.indicadores import FUSO
from giro.modelos import CategoriaCardapio, ItemCardapio, Ocupacao

# categoria, é bebida?, [(nome, preço, custo, papel na noite, peso)]
CARDAPIO: list[tuple[str, bool, list[tuple[str, int, int, str, int]]]] = [
    ("Entradas", False, [
        ("Bruschetta de tomate", 2800, 700, "entrada", 5),
        ("Pão de alho", 1800, 400, "entrada", 4),
        ("Carpaccio", 4400, 1500, "entrada", 2),
    ]),
    ("Massas", False, [
        ("Lasanha à bolonhesa", 6200, 1700, "principal", 26),
        ("Espaguete ao sugo", 4800, 1000, "principal", 18),
        ("Nhoque da casa", 5400, 1100, "principal", 10),
        ("Fettuccine Alfredo", 5800, 1600, "principal", 5),
        ("Ravioli de ricota", 5600, 1500, "principal", 6),
    ]),
    ("Pratos da casa", False, [
        ("Parmegiana de frango", 5900, 1800, "principal", 22),
        ("Filé à parmegiana", 7400, 2800, "principal", 8),
        ("Polpettone recheado", 6600, 2000, "principal", 5),
    ]),
    ("Sobremesas", False, [
        ("Tiramisù", 2600, 700, "sobremesa", 5),
        ("Pudim de leite", 1800, 400, "sobremesa", 3),
        ("Petit gâteau", 2800, 800, "sobremesa", 4),
    ]),
    ("Bebidas", True, [
        ("Refrigerante lata", 700, 260, "bebida", 26),
        ("Suco natural", 1200, 350, "bebida", 14),
        ("Água sem gás", 500, 120, "bebida", 10),
        ("Cerveja long neck", 1200, 480, "bebida", 12),
        ("Chopp 300 ml", 1300, 400, "bebida", 18),
        ("Vinho da casa (taça)", 2200, 600, "bebida", 12),
        ("Vinho da casa (garrafa)", 8900, 2800, "garrafa", 1),
        ("Café expresso", 700, 100, "cafe", 1),
    ]),
]  # fmt: skip

# Minutos de cozinha de cada papel (para o "pronto" do histórico).
PREPARO = {"entrada": 9, "principal": 18, "sobremesa": 6, "bebida": 3, "garrafa": 3, "cafe": 3}


def criar_cardapio(db: Session, restaurante_id: int) -> dict[str, list[tuple[ItemCardapio, int]]]:
    """Cria o cardápio se o restaurante ainda não tem nenhum. Devolve os itens por papel."""
    existe = db.scalar(
        select(CategoriaCardapio.id).where(CategoriaCardapio.restaurante_id == restaurante_id)
    )
    por_nome: dict[str, ItemCardapio] = {}
    if existe is None:
        for ordem, (nome_categoria, bebida, itens) in enumerate(CARDAPIO):
            categoria = CategoriaCardapio(
                restaurante_id=restaurante_id, nome=nome_categoria, ordem=ordem, bebida=bebida
            )
            db.add(categoria)
            db.flush()
            for nome, preco, custo, _, _ in itens:
                item = ItemCardapio(
                    restaurante_id=restaurante_id,
                    categoria_id=categoria.id,
                    nome=nome,
                    preco_centavos=preco,
                    custo_centavos=custo,
                )
                db.add(item)
                por_nome[nome] = item
        db.flush()
    else:
        por_nome = {
            i.nome: i
            for i in db.scalars(
                select(ItemCardapio).where(ItemCardapio.restaurante_id == restaurante_id)
            )
        }
    papeis: dict[str, list[tuple[ItemCardapio, int]]] = {}
    for _, _, itens in CARDAPIO:
        for nome, _, _, papel, peso in itens:
            if nome in por_nome and por_nome[nome].ativo:
                papeis.setdefault(papel, []).append((por_nome[nome], peso))
    return papeis


def _um(papeis: dict[str, list[tuple[ItemCardapio, int]]], papel: str, sorteio: random.Random):
    opcoes = papeis.get(papel, [])
    if not opcoes:
        return None
    return sorteio.choices([i for i, _ in opcoes], [p for _, p in opcoes])[0]


def pedidos_da_visita(
    visita: Ocupacao,
    papeis: dict[str, list[tuple[ItemCardapio, int]]],
    sorteio: random.Random,
) -> list[dict[str, Any]]:
    """O que uma turma pediu: prato e bebida para cada um, entrada às vezes, sobremesa e
    café no fim. Linhas prontas para um insert em lote."""
    if visita.sem_atendimento or visita.atendida_em is None or visita.saiu_em is None:
        return []
    contagem: dict[tuple[int, datetime], list[Any]] = {}

    def pedir(item: ItemCardapio | None, papel: str, quando: datetime) -> None:
        if item is None:
            return
        chave = (item.id, quando)
        if chave not in contagem:
            contagem[chave] = [item, 0, papel, quando]
        contagem[chave][1] += 1

    primeiro = visita.atendida_em + timedelta(minutes=2)
    fim = visita.saiu_em - timedelta(minutes=12)
    if sorteio.random() < 0.4:
        pedir(_um(papeis, "entrada", sorteio), "entrada", primeiro)
    garrafa = visita.pessoas >= 3 and sorteio.random() < 0.3
    if garrafa:
        pedir(_um(papeis, "garrafa", sorteio), "garrafa", primeiro)
    for pessoa in range(visita.pessoas):
        pedir(_um(papeis, "principal", sorteio), "principal", primeiro)
        if not (garrafa and pessoa < 3):
            pedir(_um(papeis, "bebida", sorteio), "bebida", primeiro)
        if sorteio.random() < 0.28:
            pedir(_um(papeis, "sobremesa", sorteio), "sobremesa", fim)
        if sorteio.random() < 0.15:
            pedir(_um(papeis, "cafe", sorteio), "cafe", fim)

    # Sexta e sábado o salão enche e a cozinha demora mais.
    lotado = visita.sentou_em.astimezone(FUSO).weekday() in (4, 5)
    linhas = []
    for item, quantidade, papel, quando in contagem.values():
        minutos = sorteio.uniform(0.6, 1.4) * PREPARO[papel] * (1.35 if lotado else 1.0)
        pronto = quando + timedelta(minutes=minutos)
        linhas.append(
            {
                "restaurante_id": visita.restaurante_id,
                "ocupacao_id": visita.id,
                "mesa_id": visita.mesa_id,
                "item_id": item.id,
                "nome": item.nome,
                "preco_unit_centavos": item.preco_centavos,
                "quantidade": quantidade,
                "lancado_em": quando,
                "pronto_em": min(pronto, visita.saiu_em),
            }
        )
    return linhas
