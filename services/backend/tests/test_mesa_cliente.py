"""Mesa esquecida depois do atendimento e o QR da mesa: chamar o garçom, pedir a conta e
avaliar a visita, sem login. A equipe é avisada; o cliente não vê nada além do cardápio."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from giro.banco import agora
from giro.modelos import Ocupacao
from tests.test_api_salao import mandar, mesa
from tests.test_cardapio import cardapio, id_da_mesa, lancar  # noqa: F401 (fixture)
from tests.test_copiloto import PushDeMentira


@pytest.fixture
def inicio():
    return agora() - timedelta(hours=2)


@pytest.fixture
def push(app):
    falso = PushDeMentira()
    app.state.servico.push = falso
    return falso


def titulos(push):
    return [titulo for _, titulo, _ in push.enviados]


# Mesa esquecida depois do atendimento


def test_mesa_sem_visita_avisa_a_gestao_e_some_quando_o_garcom_passa(camera, como, inicio, push):
    gerente = como("gerente@cantina.demo")
    mandar(camera, inicio, 0, 2, [{"mesa": 2, "sentados": 3}])
    mandar(camera, inicio, 2, 2.2, [{"mesa": 2, "sentados": 3, "em_pe": 1}])
    mandar(camera, inicio, 2.2, 17, [{"mesa": 2, "sentados": 3}])
    assert gerente.get("/api/salao").json()["alertas"] == []

    # 15 min depois da última foto com o garçom (2:10), sai o alerta e o aviso no celular.
    mandar(camera, inicio, 17, 18, [{"mesa": 2, "sentados": 3}])
    salao = gerente.get("/api/salao").json()
    [alerta] = salao["alertas"]
    assert (alerta["tipo"], alerta["mesa_numero"]) == ("sem_visita", 2)
    assert titulos(push) == ["Mesa 2 sem visita"]
    assert (mesa(salao, 2)["visitas"], mesa(salao, 2)["estado"]) == (1, "ocupada")

    # O garçom passa: o alerta some, e a passada fica contada na visita.
    mandar(camera, inicio, 20, 20.2, [{"mesa": 2, "sentados": 3, "em_pe": 1}])
    salao = gerente.get("/api/salao").json()
    assert salao["alertas"] == []
    assert mesa(salao, 2)["visitas"] == 2
    assert mesa(salao, 2)["ultima_visita_em"] is not None


def test_dono_muda_ou_desliga_o_aviso_de_mesa_sem_visita(app, camera, como, inicio, push):
    dono = como("dono@cantina.demo")
    restaurante = dono.get("/api/auth/sessao").json()["restaurante"]
    assert restaurante["alerta_visita_min"] == 15
    url = f"/api/restaurantes/{restaurante['id']}"
    assert dono.patch(url, json={"alerta_visita_min": 61}).status_code == 422
    assert dono.patch(url, json={"alerta_visita_min": 0}).json()["alerta_visita_min"] == 0

    mandar(camera, inicio, 0, 2, [{"mesa": 3, "sentados": 2}])
    mandar(camera, inicio, 2, 2.2, [{"mesa": 3, "sentados": 2, "em_pe": 1}])
    mandar(camera, inicio, 2.2, 40, [{"mesa": 3, "sentados": 2}])
    assert dono.get("/api/salao").json()["alertas"] == []
    assert push.enviados == []


# QR da mesa


@pytest.fixture
def qr(como):
    """O gerente abre "QR das mesas": cada mesa ativa ganha a sua chave."""
    lista = como("gerente@cantina.demo").get("/api/mesas/qr").json()
    return {m["numero"]: m["chave"] for m in lista}


def publico(app) -> TestClient:
    """O celular do cliente: sem login nenhum."""
    return TestClient(app)


def test_qr_de_cada_mesa_e_so_da_gestao(como, qr):
    assert sorted(qr) == [1, 2, 3, 4]
    assert len(set(qr.values())) == 4 and all(len(c) >= 16 for c in qr.values())
    # Abrir de novo não troca a chave (o QR impresso continua valendo).
    de_novo = como("gerente@cantina.demo").get("/api/mesas/qr").json()
    assert {m["numero"]: m["chave"] for m in de_novo} == qr
    assert como("equipe@cantina.demo").get("/api/mesas/qr").status_code == 403
    vizinho = como("dono@vizinha.demo").get("/api/mesas/qr").json()
    assert [m["numero"] for m in vizinho] == [1]
    assert vizinho[0]["chave"] not in qr.values()


def test_cliente_ve_o_cardapio_de_hoje_sem_custo(app, como, cardapio, qr):  # noqa: F811
    equipe = como("equipe@cantina.demo")
    equipe.post(
        f"/api/cardapio/itens/{cardapio['espaguete']['id']}/disponivel", json={"disponivel": False}
    )
    pagina = publico(app).get(f"/api/publico/mesas/{qr[1]}")
    assert pagina.status_code == 200
    dados = pagina.json()
    assert (dados["restaurante"], dados["mesa"], dados["com_clientes"]) == (
        "Cantina do Marcos",
        1,
        False,
    )
    itens = {i["nome"]: i for c in dados["categorias"] for i in c["itens"]}
    assert itens["Espaguete ao sugo"]["disponivel"] is False
    assert itens["Lasanha à bolonhesa"] == {
        "nome": "Lasanha à bolonhesa",
        "descricao": None,
        "preco_centavos": 6200,
        "disponivel": True,
        "sugestao": False,  # sem estoque cadastrado, a casa não sugere nada
    }
    # Nada de custo, de quem trabalha ou de quem está sentado.
    texto = pagina.text
    assert "custo" not in texto and "@" not in texto and "pessoas" not in texto


def test_chave_errada_ou_trocada_nao_abre_nada(app, como, qr):
    cliente = publico(app)
    assert cliente.get("/api/publico/mesas/curta").status_code == 422
    assert cliente.get("/api/publico/mesas/" + "x" * 22).status_code == 404
    gerente = como("gerente@cantina.demo")
    mesa_id = id_da_mesa(gerente, 2)
    nova = gerente.post(f"/api/mesas/{mesa_id}/qr/trocar").json()["chave"]
    assert nova != qr[2]
    assert cliente.get(f"/api/publico/mesas/{qr[2]}").status_code == 404
    assert cliente.get(f"/api/publico/mesas/{nova}").json()["mesa"] == 2
    # A mesa de outro restaurante não se troca daqui (nem se sabe que existe).
    vizinho = como("dono@vizinha.demo")
    assert vizinho.post(f"/api/mesas/{mesa_id}/qr/trocar").status_code == 404


def test_chamar_o_garcom_e_pedir_a_conta(app, camera, como, cardapio, qr, push):  # noqa: F811
    cliente = publico(app)
    chamar = lambda motivo: cliente.post(  # noqa: E731
        f"/api/publico/mesas/{qr[1]}/chamar", json={"motivo": motivo}
    )
    # Mesa vazia para a equipe: quem tem a foto do QR em casa não incomoda ninguém.
    r = chamar("garcom")
    assert r.status_code == 409 and "vazia" in r.json()["detail"]

    equipe, gerente = como("equipe@cantina.demo"), como("gerente@cantina.demo")
    assert lancar(equipe, id_da_mesa(equipe, 1), (cardapio["lasanha"], 2)).status_code == 201
    assert chamar("garcom").json()["texto"] == "Pronto! Alguém da equipe já vem até a mesa."
    assert chamar("garcom").json()["texto"] == "A equipe já foi avisada e está a caminho."
    assert titulos(push) == ["Mesa 1 chamou o garçom"]  # uma vez só
    assert cliente.get(f"/api/publico/mesas/{qr[1]}").json()["chamados"] == ["garcom"]

    # Pedir a conta: alerta para a equipe e a mesa mostra que pediu a conta.
    assert chamar("conta").json()["texto"] == "Pronto! A conta já vai até a mesa."
    salao = gerente.get("/api/salao").json()
    assert sorted(a["tipo"] for a in salao["alertas"]) == ["chamou_garcom", "pediu_conta"]
    assert mesa(salao, 1)["conta_pedida_em"] is not None
    assert titulos(push)[-1] == "Mesa 1 pediu a conta"

    # O garçom chega na mesa (a câmera vê alguém em pé): os dois chamados somem.
    mandar(
        camera, agora() - timedelta(seconds=20), 0, 0.3, [{"mesa": 1, "sentados": 2, "em_pe": 1}]
    )
    assert gerente.get("/api/salao").json()["alertas"] == []
    assert cliente.get(f"/api/publico/mesas/{qr[1]}").json()["chamados"] == []

    # Apertar sem parar: depois de 4 vezes num minuto, espera.
    assert chamar("garcom").status_code == 429


def test_cliente_avalia_a_visita(app, como, cardapio, qr):  # noqa: F811
    cliente = publico(app)
    avaliar = lambda nota: cliente.post(  # noqa: E731
        f"/api/publico/mesas/{qr[3]}/avaliar", json={"nota": nota}
    )
    assert avaliar(5).status_code == 409  # mesa sem ninguém
    equipe = como("equipe@cantina.demo")
    assert lancar(equipe, id_da_mesa(equipe, 3), (cardapio["lasanha"], 1)).status_code == 201
    assert avaliar(0).status_code == 422 and avaliar(6).status_code == 422
    assert avaliar(3).json()["texto"].startswith("Obrigado!")
    assert avaliar(4).status_code == 200  # mudou de ideia: vale a última
    assert cliente.get(f"/api/publico/mesas/{qr[3]}").json()["nota"] == 4
    with app.state.sessoes() as db:
        [visita] = db.scalars(select(Ocupacao)).all()
        assert visita.nota == 4 and visita.nota_em is not None
