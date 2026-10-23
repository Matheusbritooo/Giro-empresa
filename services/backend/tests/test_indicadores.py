"""Indicadores e simulador "E se?" com uma noite montada à mão (contas conferidas no papel)."""

from datetime import date, datetime, timedelta

import pytest

from giro.dominio.cenarios import Cenario, simular
from giro.dominio.indicadores import (
    FUSO,
    MesaInfo,
    Visita,
    calcular,
    intervalo_da_noite,
    noite_de,
)

NOITE = date(2026, 10, 16)  # uma sexta
INICIO, FIM = intervalo_da_noite(NOITE)
TICKET = 8500  # R$ 85 por pessoa
MESAS = [MesaInfo(1, 2), MesaInfo(2, 4)]


def h(hora: int, minuto: int = 0) -> datetime:
    return datetime(2026, 10, 16, hora, minuto, tzinfo=FUSO)


# Mesa 1: 2 pessoas, atendidas em 3 min, saem 20h40 e a mesa fica suja 15 min, no salão cheio.
# Mesa 2: 4 pessoas, esperam 10 min (passou do alerta de 5), saem 21h10, limpa em 2 min.
# Mesa 2 de novo: 2 pessoas sentam 21h20 e vão embora 21h35 sem ninguém aparecer.
VISITAS = [
    Visita(1, h(20), h(20, 3), h(20, 40), h(20, 55), pessoas=2),
    Visita(2, h(20, 10), h(20, 20), h(21, 10), h(21, 12), pessoas=4),
    Visita(2, h(21, 20), None, h(21, 35), h(21, 35), pessoas=2, sem_atendimento=True),
]


def calcular_noite(visitas=VISITAS):
    return calcular(
        visitas,
        MESAS,
        INICIO,
        FIM,
        ticket_medio_centavos=TICKET,
        limite_alerta=timedelta(minutes=5),
    )


def test_noite_vai_das_6h_as_6h():
    assert noite_de(datetime(2026, 10, 17, 1, 30, tzinfo=FUSO)) == NOITE  # madrugada de sábado
    assert noite_de(datetime(2026, 10, 17, 6, 0, tzinfo=FUSO)) == date(2026, 10, 17)
    assert datetime(2026, 10, 16, 6, 0, tzinfo=FUSO) == INICIO
    assert timedelta(days=1) == FIM - INICIO


def test_numeros_da_noite():
    r = calcular_noite()
    assert r.noites == 1
    assert (r.mesas_atendidas, r.pessoas_atendidas) == (2, 6)
    assert (r.desistencias, r.pessoas_desistiram) == (1, 2)
    assert r.giro_medio == pytest.approx(1.0)  # 2 turmas atendidas / 2 mesas
    assert r.espera_media_seg == pytest.approx(390)  # (3 + 10) / 2 min
    assert r.esperas_acima_do_limite == 1
    assert r.parada_media_seg == pytest.approx(510)  # (15 + 2) / 2 min
    assert r.parada_total_seg == pytest.approx(1020)
    assert r.permanencia_media_seg == pytest.approx(3000)  # (40 + 60) / 2 min
    assert r.hora_pico == 20


def test_dinheiro_perdido():
    r = calcular_noite()
    # Quem foi embora: 2 pessoas x R$ 85.
    assert r.perdido_desistencias_centavos == 2 * TICKET
    # Às 20h o salão estava 87,5% ocupado. A mesa 1 ficou suja das 20h40 às 20h55: tirando os
    # 3 min normais, sobram 12 min = 720 s. Com 50 min de permanência média (3000 s), isso é
    # 0,24 turma de 3 pessoas a R$ 85.
    assert r.perdido_mesa_parada_centavos == round(720 / 3000 * 3 * TICKET)
    assert r.perdido_total_centavos == r.perdido_desistencias_centavos + 6120


def test_ocupacao_e_chegadas_por_hora():
    r = calcular_noite()
    horas = {p.hora: p for p in r.por_hora}
    assert horas[20].chegadas == 2
    assert horas[21].chegadas == 1
    # 20h: mesa 1 das 20h às 20h55 (3300 s) + mesa 2 das 20h10 às 21h (3000 s), em 2 mesas.
    assert horas[20].ocupacao == pytest.approx(6300 / 7200)


def test_por_mesa():
    mesa1, mesa2 = calcular_noite().por_mesa
    assert (mesa1.visitas, mesa1.desistencias, mesa1.parada_total_seg) == (1, 0, 900)
    assert mesa1.perdido_centavos == 6120
    assert (mesa2.visitas, mesa2.desistencias) == (1, 1)
    assert mesa2.espera_media_seg == 600
    assert mesa2.perdido_centavos == 2 * TICKET  # a limpeza dela foi rápida


def test_visita_fora_do_periodo_nao_conta():
    outra_noite = Visita(1, h(20) + timedelta(days=1), None, None, None, pessoas=2)
    assert calcular_noite([*VISITAS, outra_noite]).mesas_atendidas == 2


def test_periodo_sem_movimento():
    r = calcular_noite([])
    assert r.mesas_atendidas == 0
    assert r.giro_medio == 0
    assert r.espera_media_seg is None
    assert r.hora_pico is None
    assert r.perdido_total_centavos == 0


def simular_noite(cenario: Cenario):
    return simular(VISITAS, MESAS, INICIO, FIM, cenario, ticket_medio_centavos=TICKET)


def test_e_se_limpeza_mais_rapida():
    r = simular_noite(Cenario(limpeza_max=timedelta(minutes=5)))
    # Da mesa 1 sobram 10 min (20h45 às 20h55) na hora cheia: 600 / 3000 = 0,2 turma.
    assert r.turmas_a_mais == pytest.approx(0.2)
    assert r.ganho_centavos == round(0.2 * 3 * TICKET)
    assert r.parada_media_nova_seg == pytest.approx((300 + 120) / 2)
    assert r.ganho_mes_centavos == r.ganho_centavos * 30  # o período é uma noite


def test_e_se_mais_garcons():
    r = simular_noite(Cenario(garcons_atual=2, garcons_novo=3))
    # Esperas de 3 e 10 min viram 2 e 6,67 min (média 260 s). Quem foi embora esperou 15 min:
    # com a nova espera, teria sido atendido.
    assert r.espera_media_nova_seg == pytest.approx(260)
    assert r.desistencias_evitadas == 1
    assert r.ganho_centavos == 2 * TICKET


def test_e_se_menos_garcons():
    r = simular_noite(Cenario(garcons_atual=3, garcons_novo=1))
    # Esperas triplicam: os 10 min da mesa 2 viram 30, mais que os 15 min de paciência de quem
    # já foi embora. As 4 pessoas da mesa 2 iriam embora.
    assert r.desistencias_novas == 1
    assert r.ganho_centavos == -4 * TICKET


def test_e_se_sem_mudanca():
    r = simular_noite(Cenario())
    assert r.ganho_centavos == 0
    assert r.turmas_a_mais == 0
