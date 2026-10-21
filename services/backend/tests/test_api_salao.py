"""Fluxo completo de uma mesa pela API: câmera manda, banco grava, painel recebe."""

from datetime import timedelta

import pytest

from giro.banco import agora
from tests.conftest import ORIGEM, SENHA, TOKEN_CAMERA_OUTRO


@pytest.fixture
def inicio():
    # Observações "do passado" para o teste não esperar 5 minutos de verdade.
    return agora() - timedelta(hours=2)


def mandar(camera, inicio, de_min, ate_min, observacoes):
    t = inicio + timedelta(minutes=de_min)
    fim = inicio + timedelta(minutes=ate_min)
    while t < fim:
        resposta = camera(observacoes, em=t)
        assert resposta.status_code == 200, resposta.text
        t += timedelta(seconds=10)


def mesa(salao, numero):
    return next(m for m in salao["mesas"] if m["numero"] == numero)


def test_ciclo_completo_da_mesa(camera, como, inicio):
    gerente = como("gerente@cantina.demo")

    # Duas pessoas sentam na mesa 2 e ninguém atende por 6 minutos.
    mandar(camera, inicio, 0, 6, [{"mesa": 2, "sentados": 2}])
    salao = gerente.get("/api/salao").json()
    assert mesa(salao, 2)["estado"] == "aguardando"
    assert mesa(salao, 2)["pessoas"] == 2
    [alerta] = salao["alertas"]
    assert alerta["tipo"] == "sem_atendimento"
    assert alerta["mesa_numero"] == 2

    # Gerente vê o alerta e marca que está cuidando.
    reconhecido = gerente.post(f"/api/alertas/{alerta['id']}/reconhecer").json()
    assert reconhecido["reconhecido_em"] is not None

    # Garçom chega: alerta resolvido sozinho.
    mandar(camera, inicio, 6, 6.2, [{"mesa": 2, "sentados": 2, "em_pe": 1}])
    salao = gerente.get("/api/salao").json()
    assert mesa(salao, 2)["estado"] == "ocupada"
    assert salao["alertas"] == []

    # Clientes saem: mesa para limpar com alerta de mesa vaga.
    mandar(camera, inicio, 6.2, 50, [{"mesa": 2, "sentados": 2}])
    mandar(camera, inicio, 50, 52, [{"mesa": 2, "sentados": 0}])
    salao = gerente.get("/api/salao").json()
    assert mesa(salao, 2)["estado"] == "para_limpar"
    assert [a["tipo"] for a in salao["alertas"]] == ["mesa_vaga"]

    # Garçom libera pelo celular.
    equipe = como("equipe@cantina.demo")
    mesa_id = mesa(salao, 2)["id"]
    liberada = equipe.post(f"/api/mesas/{mesa_id}/liberar")
    assert liberada.status_code == 200
    assert liberada.json()["estado"] == "livre"
    assert gerente.get("/api/salao").json()["alertas"] == []
    assert equipe.post(f"/api/mesas/{mesa_id}/liberar").status_code == 409


def test_ocupacao_fica_gravada_para_os_indicadores(app, camera, inicio):
    from sqlalchemy import select

    from giro.modelos import EventoMesa, Ocupacao

    mandar(camera, inicio, 0, 3, [{"mesa": 1, "sentados": 3}])
    mandar(camera, inicio, 3, 3.1, [{"mesa": 1, "sentados": 4, "em_pe": 1}])
    mandar(camera, inicio, 3.1, 40, [{"mesa": 1, "sentados": 4}])
    mandar(camera, inicio, 40, 42, [{"mesa": 1, "sentados": 0}])
    mandar(camera, inicio, 61, 62, [{"mesa": 1, "sentados": 2}])  # nova turma senta na mesa suja

    with app.state.sessoes() as db:
        primeira, segunda = db.scalars(select(Ocupacao).order_by(Ocupacao.id)).all()
        assert primeira.sentou_em == inicio
        assert primeira.atendida_em == inicio + timedelta(minutes=3)
        assert primeira.saiu_em == inicio + timedelta(minutes=40)
        assert primeira.liberada_em == inicio + timedelta(minutes=61)  # 21 min parada suja
        assert primeira.pessoas == 4
        assert segunda.liberada_em is None
        tipos = [e.tipo for e in db.scalars(select(EventoMesa).order_by(EventoMesa.id))]
    assert tipos == [
        "sentou",
        "atendida",
        "saiu",
        "alerta_mesa_vaga",
        "liberada",
        "sentou",
    ]


def test_cliente_que_desiste_fica_registrado(app, camera, inicio):
    from sqlalchemy import select

    from giro.modelos import Ocupacao

    mandar(camera, inicio, 0, 4, [{"mesa": 3, "sentados": 2}])
    mandar(camera, inicio, 4, 6, [{"mesa": 3, "sentados": 0}])
    with app.state.sessoes() as db:
        [ocupacao] = db.scalars(select(Ocupacao)).all()
        assert ocupacao.sem_atendimento is True
        assert ocupacao.liberada_em == ocupacao.saiu_em


def test_alerta_dispara_pelo_relogio_mesmo_sem_foto_nova(app, camera, como, inicio):
    mandar(camera, inicio, 0, 1, [{"mesa": 4, "sentados": 2}])
    assert como("gerente@cantina.demo").get("/api/salao").json()["alertas"] == []
    with app.state.sessoes() as db:
        app.state.servico.verificar_tempos(db, inicio + timedelta(minutes=5, seconds=5))
    [alerta] = como("gerente@cantina.demo").get("/api/salao").json()["alertas"]
    assert alerta["mesa_numero"] == 4


def test_camera_com_token_errado_nao_entra(camera):
    assert camera([{"mesa": 1, "sentados": 1}], token="cam_inventado").status_code == 401
    assert camera([{"mesa": 1, "sentados": 1}], token="").status_code == 401


def test_camera_so_mexe_nas_mesas_do_proprio_restaurante(camera, como):
    # A câmera da pizzaria manda "mesa 2", que só existe na cantina.
    resposta = camera([{"mesa": 2, "sentados": 3}], token=TOKEN_CAMERA_OUTRO)
    assert resposta.json() == {"processadas": 0, "mesas_desconhecidas": [2]}


def test_foto_com_hora_errada_e_recusada(camera):
    assert (
        camera([{"mesa": 1, "sentados": 1}], em=agora() + timedelta(minutes=5)).status_code == 422
    )
    assert camera([{"mesa": 1, "sentados": 1}], em=agora() - timedelta(days=2)).status_code == 422


def test_painel_recebe_o_salao_e_as_mudancas_ao_vivo(cliente, camera, inicio):
    login = cliente.post("/api/auth/entrar", json={"email": "equipe@cantina.demo", "senha": SENHA})
    cookie = f"giro_sessao={login.cookies['giro_sessao']}"
    with cliente.websocket_connect(
        "/api/ao-vivo", headers={"origin": ORIGEM, "cookie": cookie}
    ) as ws:
        inicial = ws.receive_json()
        assert inicial["tipo"] == "salao"
        assert len(inicial["salao"]["mesas"]) == 4

        mandar(camera, inicio, 0, 0.5, [{"mesa": 1, "sentados": 2}])
        mensagem = ws.receive_json()
        assert mensagem["tipo"] == "mesa"
        assert mensagem["mesa"]["numero"] == 1
        assert mensagem["mesa"]["estado"] == "aguardando"

        mandar(camera, inicio, 0.5, 5.1, [{"mesa": 1, "sentados": 2}])
        while (mensagem := ws.receive_json())["tipo"] != "alerta":
            pass
        assert mensagem["alerta"]["tipo"] == "sem_atendimento"
        assert mensagem["alerta"]["mesa_numero"] == 1


def test_canal_ao_vivo_recusa_outro_site_e_quem_nao_logou(cliente):
    from starlette.websockets import WebSocketDisconnect

    login = cliente.post("/api/auth/entrar", json={"email": "equipe@cantina.demo", "senha": SENHA})
    cookie = f"giro_sessao={login.cookies['giro_sessao']}"
    malicioso = {"origin": "https://site-malicioso.example", "cookie": cookie}
    with (
        pytest.raises(WebSocketDisconnect),
        cliente.websocket_connect("/api/ao-vivo", headers=malicioso),
    ):
        pass

    cliente.cookies.clear()
    with (
        pytest.raises(WebSocketDisconnect),
        cliente.websocket_connect("/api/ao-vivo", headers={"origin": ORIGEM}),
    ):
        pass


def test_inscricao_de_push_so_aceita_servicos_dos_navegadores(como):
    gerente = como("gerente@cantina.demo")
    chaves = {"p256dh": "chave", "auth": "segredo"}
    interno = {"endpoint": "https://169.254.169.254/latest", "keys": chaves}
    assert gerente.post("/api/push/inscricoes", json=interno).status_code == 422
    chrome = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc123", "keys": chaves}
    assert gerente.post("/api/push/inscricoes", json=chrome).status_code == 204
    assert gerente.get("/api/push/chave-publica").json() == {"chave_publica": None}
