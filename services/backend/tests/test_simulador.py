from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from giro.simulador.ao_vivo import rodar_ao_vivo
from giro.simulador.cenario import gerar_noite, por_nome, rodar_local, todos, verificar
from tests.conftest import TOKEN_CAMERA


@pytest.mark.parametrize("cenario", todos(), ids=lambda c: c.nome)
def test_cenario(cenario):
    assert verificar(cenario, rodar_local(cenario)) == []


def test_noite_aleatoria_e_repetivel_com_a_mesma_semente():
    a = gerar_noite([1, 2, 3], duracao_min=60, semente=7)
    b = gerar_noite([1, 2, 3], duracao_min=60, semente=7)
    assert a.passos == b.passos
    assert rodar_local(a)  # acontece alguma coisa e a máquina não quebra


def test_ao_vivo_manda_para_a_api(app, cliente, como):
    cenario = por_nome("atendimento-rapido")  # mesa 1
    linhas = []
    rodar_ao_vivo(
        cenario,
        api="",
        token=TOKEN_CAMERA,
        inicio_em=cenario.duracao,  # tudo já "aconteceu": manda de uma vez, sem esperar
        dormir=lambda s: pytest.fail("não devia esperar"),
        saida=linhas.append,
        cliente=TestClient(app),
    )
    salao = como("gerente@cantina.demo").get("/api/salao").json()
    mesa = next(m for m in salao["mesas"] if m["numero"] == 1)
    # Ao vivo quem libera é a equipe pelo painel, então a mesa fica esperando limpeza.
    assert mesa["estado"] == "para_limpar"
    assert [a["tipo"] for a in salao["alertas"]] == ["mesa_vaga"]
    assert any("liberar" in linha for linha in linhas)
    assert linhas[-1] == "Cenário terminou."


def test_inicio_no_meio_nao_passa_do_fim(app, cliente):
    cenario = por_nome("desistiu")
    esperas = []
    rodar_ao_vivo(
        cenario,
        api="",
        token=TOKEN_CAMERA,
        inicio_em=cenario.duracao - timedelta(seconds=30),
        dormir=esperas.append,
        saida=lambda _: None,
        cliente=TestClient(app),
    )
    assert 1 <= len(esperas) <= 4
    assert all(0 < s <= 30 for s in esperas)
