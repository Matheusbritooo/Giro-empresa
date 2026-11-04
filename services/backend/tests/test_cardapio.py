"""Cardápio e pedidos: perfis, isolamento entre restaurantes, preço congelado, cozinha,
cancelamento com motivo, pedido que conta como atendimento e as contas dos resultados."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select

from giro.banco import agora
from giro.demo_historico import gerar_historico, refazer_historico
from giro.dominio.indicadores import noite_de
from giro.modelos import ItemPedido, Ocupacao, Restaurante
from tests.test_api_salao import mandar


@pytest.fixture
def cardapio(como):
    """Duas categorias da Cantina, cadastradas pelo dono: massas e bebidas."""
    dono = como("dono@cantina.demo")
    massas = dono.post("/api/cardapio/categorias", json={"nome": "Massas"}).json()
    bebidas = dono.post("/api/cardapio/categorias", json={"nome": "Bebidas", "bebida": True})
    bebidas = bebidas.json()

    def item(nome, preco, categoria, custo=None):
        corpo = {"categoria_id": categoria["id"], "nome": nome, "preco_centavos": preco}
        if custo is not None:
            corpo["custo_centavos"] = custo
        resposta = dono.post("/api/cardapio/itens", json=corpo)
        assert resposta.status_code == 201, resposta.text
        return resposta.json()

    return {
        "lasanha": item("Lasanha à bolonhesa", 6200, massas, custo=1700),
        "espaguete": item("Espaguete ao sugo", 4800, massas, custo=1000),
        "refri": item("Refrigerante lata", 700, bebidas, custo=260),
    }


def id_da_mesa(cliente, numero):
    return next(m["id"] for m in cliente.get("/api/salao").json()["mesas"] if m["numero"] == numero)


def lancar(cliente, mesa_id, *linhas):
    itens = [{"item_id": i["id"], "quantidade": q} for i, q in linhas]
    return cliente.post(f"/api/mesas/{mesa_id}/pedidos", json={"itens": itens})


def test_custo_so_o_dono_ve_e_muda(como, cardapio):
    dono, gerente = como("dono@cantina.demo"), como("gerente@cantina.demo")
    visto_pelo_dono = dono.get("/api/cardapio").json()
    assert visto_pelo_dono["mostra_custo"] is True
    assert {i["custo_centavos"] for i in visto_pelo_dono["itens"]} == {1700, 1000, 260}

    visto_pelo_gerente = gerente.get("/api/cardapio").json()
    assert visto_pelo_gerente["mostra_custo"] is False
    assert {i["custo_centavos"] for i in visto_pelo_gerente["itens"]} == {None}

    lasanha = cardapio["lasanha"]["id"]
    r = gerente.patch(f"/api/cardapio/itens/{lasanha}", json={"preco_centavos": 6500})
    assert r.status_code == 200
    r = gerente.patch(f"/api/cardapio/itens/{lasanha}", json={"custo_centavos": 100})
    assert r.status_code == 403


def test_equipe_ve_o_cardapio_ativo_e_marca_que_acabou(como, cardapio):
    dono, equipe = como("dono@cantina.demo"), como("equipe@cantina.demo")
    dono.patch(f"/api/cardapio/itens/{cardapio['espaguete']['id']}", json={"ativo": False})
    nomes = [i["nome"] for i in equipe.get("/api/cardapio").json()["itens"]]
    assert nomes == ["Lasanha à bolonhesa", "Refrigerante lata"]
    # A gestão continua vendo o que saiu, para poder voltar com ele.
    assert len(dono.get("/api/cardapio").json()["itens"]) == 3

    assert equipe.post("/api/cardapio/categorias", json={"nome": "Pizzas"}).status_code == 403
    r = equipe.post(f"/api/cardapio/itens/{cardapio['lasanha']['id']}/disponivel", json={
        "disponivel": False
    })  # fmt: skip
    assert r.json()["disponivel"] is False

    mesa = id_da_mesa(equipe, 1)
    r = lancar(equipe, mesa, (cardapio["lasanha"], 1))
    assert r.status_code == 409
    assert r.json()["detail"] == "Lasanha à bolonhesa acabou"
    r = lancar(equipe, mesa, (cardapio["espaguete"], 1))
    assert r.json()["detail"] == "Espaguete ao sugo saiu do cardápio"


def test_um_restaurante_nao_mexe_no_cardapio_nem_nas_mesas_do_outro(como, cardapio):
    vizinho = como("dono@vizinha.demo")
    assert vizinho.get("/api/cardapio").json()["itens"] == []
    lasanha = cardapio["lasanha"]["id"]
    assert (
        vizinho.patch(f"/api/cardapio/itens/{lasanha}", json={"preco_centavos": 1}).status_code
        == 404
    )
    r = vizinho.post(f"/api/cardapio/itens/{lasanha}/disponivel", json={"disponivel": False})
    assert r.status_code == 404

    # Mesa da cantina: o vizinho não vê nem lança.
    mesa_cantina = id_da_mesa(como("gerente@cantina.demo"), 1)
    assert vizinho.get(f"/api/mesas/{mesa_cantina}/pedido").status_code == 404
    assert lancar(vizinho, mesa_cantina, (cardapio["lasanha"], 1)).status_code == 404

    # Mesa do vizinho com item da cantina: o item não existe para ele.
    mesa_vizinha = id_da_mesa(vizinho, 1)
    r = lancar(vizinho, mesa_vizinha, (cardapio["lasanha"], 1))
    assert r.status_code == 404

    # Categoria da cantina não serve para item do vizinho.
    categoria = cardapio["lasanha"]["categoria_id"]
    r = vizinho.post(
        "/api/cardapio/itens",
        json={"categoria_id": categoria, "nome": "Pizza", "preco_centavos": 5000},
    )
    assert r.status_code == 404


def test_pedido_em_mesa_livre_abre_a_visita_e_mostra_o_total_no_salao(como, cardapio):
    equipe = como("equipe@cantina.demo")
    mesa = id_da_mesa(equipe, 3)
    r = lancar(equipe, mesa, (cardapio["lasanha"], 2), (cardapio["refri"], 2))
    assert r.status_code == 201, r.text
    pedido = r.json()
    assert pedido["mesa"]["estado"] == "ocupada"
    assert pedido["total_centavos"] == 2 * 6200 + 2 * 700
    assert [i["nome"] for i in pedido["itens"]] == ["Lasanha à bolonhesa", "Refrigerante lata"]

    salao = equipe.get("/api/salao").json()
    mesa3 = next(m for m in salao["mesas"] if m["numero"] == 3)
    assert mesa3["total_pedido_centavos"] == 13800
    assert mesa3["itens_na_cozinha"] == 4


def test_pedido_tira_o_alerta_de_mesa_sem_atendimento(como, camera, cardapio):
    gerente = como("gerente@cantina.demo")
    inicio = agora() - timedelta(minutes=8)
    mandar(camera, inicio, 0, 6, [{"mesa": 2, "sentados": 3}])
    salao = gerente.get("/api/salao").json()
    assert [a["tipo"] for a in salao["alertas"]] == ["sem_atendimento"]

    equipe = como("equipe@cantina.demo")
    assert lancar(equipe, id_da_mesa(equipe, 2), (cardapio["espaguete"], 3)).status_code == 201
    salao = gerente.get("/api/salao").json()
    assert salao["alertas"] == []
    mesa2 = next(m for m in salao["mesas"] if m["numero"] == 2)
    assert mesa2["estado"] == "ocupada"
    assert mesa2["atendida_em"] is not None
    assert mesa2["pessoas"] == 3


def test_preco_novo_nao_muda_o_que_ja_foi_pedido(como, cardapio):
    equipe, dono = como("equipe@cantina.demo"), como("dono@cantina.demo")
    mesa = id_da_mesa(equipe, 1)
    lancar(equipe, mesa, (cardapio["lasanha"], 1))
    dono.patch(f"/api/cardapio/itens/{cardapio['lasanha']['id']}", json={"preco_centavos": 7000})
    pedido = lancar(equipe, mesa, (cardapio["lasanha"], 1)).json()
    assert [i["preco_unit_centavos"] for i in pedido["itens"]] == [6200, 7000]
    assert pedido["total_centavos"] == 13200


def test_cozinha_marca_pronto_e_gerente_cancela_com_motivo(como, cardapio):
    equipe, gerente = como("equipe@cantina.demo"), como("gerente@cantina.demo")
    mesa = id_da_mesa(equipe, 4)
    pedido = lancar(equipe, mesa, (cardapio["lasanha"], 1), (cardapio["refri"], 2)).json()
    lasanha, refri = pedido["itens"]

    cozinha = equipe.get("/api/cozinha").json()
    assert [(c["mesa_numero"], c["nome"]) for c in cozinha] == [
        (4, "Lasanha à bolonhesa"),
        (4, "Refrigerante lata"),
    ]
    assert equipe.post(f"/api/pedidos/{refri['id']}/pronto").json()["pronto_em"] is not None
    assert [c["nome"] for c in equipe.get("/api/cozinha").json()] == ["Lasanha à bolonhesa"]

    # Garçom não cancela; gerente cancela, e só com um motivo da lista.
    motivo = {"motivo": "Cliente desistiu"}
    assert equipe.post(f"/api/pedidos/{lasanha['id']}/cancelar", json=motivo).status_code == 403
    r = gerente.post(f"/api/pedidos/{lasanha['id']}/cancelar", json={"motivo": "porque sim"})
    assert r.status_code == 422
    cancelado = gerente.post(f"/api/pedidos/{lasanha['id']}/cancelar", json=motivo).json()
    assert cancelado["motivo_cancelamento"] == "Cliente desistiu"
    assert equipe.get("/api/cozinha").json() == []
    assert equipe.post(f"/api/pedidos/{lasanha['id']}/pronto").status_code == 409

    pedido = equipe.get(f"/api/mesas/{mesa}/pedido").json()
    assert pedido["total_centavos"] == 1400  # a lasanha cancelada não conta
    assert pedido["mesa"]["itens_na_cozinha"] == 0

    vizinho = como("dono@vizinha.demo")
    assert vizinho.post(f"/api/pedidos/{refri['id']}/pronto").status_code == 404
    assert vizinho.post(f"/api/pedidos/{refri['id']}/cancelar", json=motivo).status_code == 404


@pytest.fixture
def cantina_com_pedidos(app):
    with app.state.sessoes() as db:
        cantina = db.scalar(select(Restaurante).where(Restaurante.nome == "Cantina do Marcos"))
        gerar_historico(db, cantina.id, noite_de(agora()))
        db.commit()
        return cantina.id


def test_resultados_do_cardapio(como, cantina_com_pedidos):
    dono = como("dono@cantina.demo")
    r = dono.get("/api/resultados/cardapio", params={"periodo": "semana"})
    assert r.status_code == 200, r.text
    dados = r.json()
    assert dados["visitas_com_pedido"] > 50
    comida = [i for i in dados["itens"] if not i["bebida"]]
    bebida = [i for i in dados["itens"] if i["bebida"]]
    assert comida[0]["nome"] == "Lasanha à bolonhesa"  # o prato da casa
    assert bebida and all(b["categoria"] == "Bebidas" for b in bebida)
    assert sum(m["total_centavos"] for m in dados["mesas"]) == dados["faturamento_centavos"]
    assert 6000 < dados["ticket_real_centavos"] < 11000
    assert all(m["prato"] for m in dados["mesas"])

    # O "dinheiro que ficou na mesa" passa a usar o ticket real.
    semana = dono.get("/api/resultados", params={"periodo": "semana"}).json()["atual"]
    assert semana["ticket_real"] is True
    assert semana["ticket_medio_centavos"] == dados["ticket_real_centavos"]

    # O garçom não vê os resultados, mas recebe os mais pedidos para pôr no topo.
    equipe = como("equipe@cantina.demo")
    assert equipe.get("/api/resultados/cardapio").status_code == 403
    cardapio = equipe.get("/api/cardapio").json()
    nomes = {i["id"]: i["nome"] for i in cardapio["itens"]}
    assert len(cardapio["mais_pedidos"]) == 8
    assert "Lasanha à bolonhesa" in [nomes[i] for i in cardapio["mais_pedidos"][:3]]
    vizinho = como("dono@vizinha.demo")
    params = {"restaurante_id": cantina_com_pedidos}
    assert vizinho.get("/api/resultados/cardapio", params=params).status_code == 404
    assert vizinho.get("/api/resultados/cardapio").json()["itens"] == []


def test_refazer_o_historico_leva_os_pedidos_junto(app, cantina_com_pedidos):
    with app.state.sessoes() as db:
        antes = db.scalar(select(func.count(ItemPedido.id)))
        assert antes > 1000
        refazer_historico(db, cantina_com_pedidos, noite_de(agora()))
        db.commit()
        assert db.scalar(select(func.count(ItemPedido.id))) == antes
        visitas = select(Ocupacao.id)
        orfaos = select(func.count(ItemPedido.id)).where(ItemPedido.ocupacao_id.not_in(visitas))
        assert db.scalar(orfaos) == 0


def test_pediu_a_conta_mostra_quando_a_mesa_deve_vagar(como, cardapio):
    equipe = como("equipe@cantina.demo")
    mesa = id_da_mesa(equipe, 2)
    assert equipe.post(f"/api/mesas/{mesa}/conta", json={}).status_code == 409  # mesa livre
    lancar(equipe, mesa, (cardapio["lasanha"], 2))

    r = equipe.post(f"/api/mesas/{mesa}/conta", json={})
    assert r.status_code == 200, r.text
    dados = r.json()
    conta = datetime.fromisoformat(dados["conta_pedida_em"])
    vaga = datetime.fromisoformat(dados["vaga_prevista_em"])
    assert vaga - conta == timedelta(minutes=10)  # sem histórico: 10 min
    salao = equipe.get("/api/salao").json()
    assert next(m for m in salao["mesas"] if m["id"] == mesa)["conta_pedida_em"] is not None

    # Tocou sem querer: desfaz.
    dados = equipe.post(f"/api/mesas/{mesa}/conta", json={"pedida": False}).json()
    assert dados["conta_pedida_em"] is None and dados["vaga_prevista_em"] is None
    assert como("dono@vizinha.demo").post(f"/api/mesas/{mesa}/conta", json={}).status_code == 404


def test_previsao_de_vaga_aprende_com_as_contas_das_ultimas_semanas(como, cantina_com_pedidos):
    equipe = como("equipe@cantina.demo")
    mesa = id_da_mesa(equipe, 3)
    cardapio = equipe.get("/api/cardapio").json()
    lasanha = next(i for i in cardapio["itens"] if i["nome"] == "Lasanha à bolonhesa")
    lancar(equipe, mesa, (lasanha, 1))
    dados = equipe.post(f"/api/mesas/{mesa}/conta", json={}).json()
    minutos = (
        datetime.fromisoformat(dados["vaga_prevista_em"])
        - datetime.fromisoformat(dados["conta_pedida_em"])
    ).total_seconds() / 60
    assert 8 <= minutos <= 12  # o histórico tem contas pedidas de 6 a 14 min antes de sair


def test_matriz_de_lucro_so_para_o_dono_e_o_resto_para_a_gestao(como, cantina_com_pedidos):
    params = {"periodo": "mes"}
    dono = como("dono@cantina.demo").get("/api/resultados/cardapio", params=params).json()
    gerente = como("gerente@cantina.demo").get("/api/resultados/cardapio", params=params).json()

    assert gerente["matrizes"] is None
    categorias = [m["categoria"] for m in dono["matrizes"]]
    assert categorias[0] == "Massas"  # a que mais fatura vem primeiro
    massas = {i["nome"]: i["quadrante"] for i in dono["matrizes"][0]["matriz"]["itens"]}
    assert massas["Lasanha à bolonhesa"] == "estrela"
    assert set(massas.values()) <= {"estrela", "burro_de_carga", "quebra_cabeca", "cao"}

    # Combinações e tempo de cozinha: para dono e gerente.
    for dados in (dono, gerente):
        [primeira, *_] = dados["combinacoes"]
        assert primeira["item"] == "Lasanha à bolonhesa"
        assert primeira["acompanha"] and all(
            0 < a["percentual"] <= 100 for a in primeira["acompanha"]
        )
        # Acompanhamento é bebida, entrada ou sobremesa, nunca outro prato.
        assert "Parmegiana de frango" not in [a["nome"] for a in primeira["acompanha"]]
        lento = dados["tempos"][0]["tempo"]
        assert lento["minutos_fim_de_semana"] > lento["minutos_semana"]  # sexta e sábado enchem
