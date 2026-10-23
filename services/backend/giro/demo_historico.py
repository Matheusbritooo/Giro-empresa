"""Histórico de demonstração: 4 semanas de jantar na Cantina do Marcos.

Gera visitas às mesas (tabela `ocupacoes`) com o jeito de uma cantina de bairro: fecha às
segundas, sexta e sábado lotados, pico perto das 20h30, cliente que cansa de esperar e vai
embora, e a mesa 7 (a de 6 lugares, perto da cozinha) que fica suja quando o salão enche,
como na história do Marcos no TCM. Sempre os mesmos números (semente fixa).

Só serve para mostrar os resultados, o replay e o Copiloto antes de existir câmera de verdade.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.dominio.indicadores import FUSO, intervalo_da_noite
from giro.modelos import Mesa, Ocupacao

# Turmas por noite em cada dia da semana (segunda = 0, fechado).
TURMAS = {1: 20, 2: 22, 3: 30, 4: 52, 5: 56, 6: 32}
TAMANHOS = [(1, 6), (2, 42), (3, 14), (4, 26), (5, 6), (6, 5), (8, 1)]  # pessoas, peso
MESA_LENTA = 7  # a mesa que fica suja quando o salão enche


@dataclass
class _Mesa:
    id: int
    numero: int
    lugares: int
    livre_em: datetime


def _chegada(dia: date, sorteio: random.Random) -> datetime:
    """Horário de chegada: a maioria perto das 20h30, entre 18h30 e 22h45."""
    minutos = min(max(sorteio.gauss(20.5 * 60, 55), 18.5 * 60), 22.75 * 60)
    return datetime.combine(dia, time(0), FUSO) + timedelta(minutes=minutos)


def _noite(
    dia: date, mesas: list[_Mesa], restaurante_id: int, sorteio: random.Random
) -> list[Ocupacao]:
    turmas = TURMAS.get(dia.weekday(), 0)
    chegadas = sorted(_chegada(dia, sorteio) for _ in range(turmas))
    pessoas_e_pesos = list(zip(*TAMANHOS, strict=True))
    visitas = []
    for chegou in chegadas:
        pessoas = sorteio.choices(pessoas_e_pesos[0], pessoas_e_pesos[1])[0]
        # Espera até 15 min por uma mesa que caiba a turma; senão, vai embora sem sentar.
        cabem = sorted((m for m in mesas if m.lugares >= pessoas), key=lambda m: m.lugares)
        livres = [m for m in cabem if m.livre_em <= chegou + timedelta(minutes=15)]
        if not livres:
            continue
        mesa = min(livres, key=lambda m: (max(m.livre_em, chegou), m.lugares))
        sentou = max(mesa.livre_em, chegou)
        ocupadas = sum(1 for m in mesas if m.livre_em > sentou)
        cheio = ocupadas / len(mesas) >= 0.7

        espera = sorteio.lognormvariate(1.0, 0.5) * (2.6 if cheio else 1.0)  # minutos
        paciencia = sorteio.uniform(8, 18)
        if espera > paciencia:  # cansou de esperar
            saiu = sentou + timedelta(minutes=paciencia)
            visitas.append(
                Ocupacao(
                    restaurante_id=restaurante_id,
                    mesa_id=mesa.id,
                    sentou_em=sentou,
                    saiu_em=saiu,
                    liberada_em=saiu,
                    pessoas=pessoas,
                    sem_atendimento=True,
                )
            )
            mesa.livre_em = saiu
            continue

        atendida = sentou + timedelta(minutes=espera)
        permanencia = sorteio.gauss(40 + 6 * pessoas, 9)
        saiu = atendida + timedelta(minutes=max(permanencia, 25))
        parada = sorteio.lognormvariate(1.1, 0.4) * (2.4 if cheio else 1.0)
        if mesa.numero == MESA_LENTA and cheio:
            parada += sorteio.uniform(6, 14)
        liberada = saiu + timedelta(minutes=min(parada, 30))
        visitas.append(
            Ocupacao(
                restaurante_id=restaurante_id,
                mesa_id=mesa.id,
                sentou_em=sentou,
                atendida_em=atendida,
                saiu_em=saiu,
                liberada_em=liberada,
                pessoas=pessoas,
            )
        )
        mesa.livre_em = liberada
    return visitas


def gerar_historico(
    db: Session, restaurante_id: int, hoje: date, semanas: int = 4, semente: int = 7
) -> int:
    """Cria as noites das últimas `semanas`, se ainda não houver histórico.

    Devolve quantas visitas criou.
    """
    inicio_de_hoje, _ = intervalo_da_noite(hoje)
    ja_tem = db.scalar(
        select(Ocupacao.id)
        .where(Ocupacao.restaurante_id == restaurante_id, Ocupacao.sentou_em < inicio_de_hoje)
        .limit(1)
    )
    if ja_tem is not None:
        return 0
    linhas = db.scalars(
        select(Mesa)
        .where(Mesa.restaurante_id == restaurante_id, Mesa.ativa.is_(True))
        .order_by(Mesa.numero)
    ).all()
    if not linhas:
        return 0

    sorteio = random.Random(semente)  # noqa: S311 (dado de demonstração, não é segredo)
    total = 0
    for dias_atras in range(semanas * 7, 0, -1):
        dia = hoje - timedelta(days=dias_atras)
        comeco = datetime.combine(dia, time(18), FUSO)
        mesas = [_Mesa(m.id, m.numero, m.lugares, comeco) for m in linhas]
        visitas = _noite(dia, mesas, restaurante_id, sorteio)
        db.add_all(visitas)
        total += len(visitas)
    return total
