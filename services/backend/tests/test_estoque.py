"""Estoque: quem faz o quê, isolamento entre restaurantes, baixa pelo pedido, estorno e perda
no cancelamento, compra com custo médio, contagem e o custo do prato pela ficha."""

import pytest

from tests.test_cardapio import cardapio, id_da_mesa, lancar  # noqa: F401 (cardapio é fixture)


def criar(cliente, nome, unidade, custo=None, saldo=None, embalagem=1000):
    corpo = {"nome": nome, "unidade": unidade, "embalagem_quantidade": embalagem}
    if custo is not None:
        corpo["custo_centavos"] = custo
    if saldo is not None:
        corpo["saldo"] = saldo
    resposta = cliente.post("/api/estoque/insumos", json=corpo)
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def ficha(cliente, item, linhas, outros=None):
    corpo = {"linhas": [{"insumo_id": i["id"], "quantidade": q} for i, q in linhas]}
    if outros is not None:
        corpo["custo_outros_centavos"] = outros
    return cliente.post(f"/api/cardapio/itens/{item['id']}/ficha", json=corpo)


def saldos(cliente):
    return {i["nome"]: i["saldo"] for i in cliente.get("/api/estoque").json()["insumos"]}


def custo_no_cardapio(cliente, nome):
    return next(i for i in cliente.get("/api/cardapio").json()["itens"] if i["nome"] == nome)


@pytest.fixture
def estoque(como, cardapio):  # noqa: F811
    """O gerente cadastra 4 ingredientes já contados; o dono monta a ficha da lasanha
    (R$ 2,16 de massa + R$ 4,56 de carne + R$ 4,20 de muçarela + R$ 3,50 de outros) e do
    refrigerante (uma lata)."""
    gerente, dono = como("gerente@cantina.demo"), como("dono@cantina.demo")
    insumos = {
        "massa": criar(gerente, "Massa de lasanha", "g", custo=1800, saldo=5000),
        "carne": criar(gerente, "Carne moída", "g", custo=3800, saldo=4000),
        "mucarela": criar(gerente, "Muçarela", "g", custo=4200, saldo=3000),
        "refri": criar(gerente, "Refrigerante lata", "un", custo=260, saldo=24, embalagem=12),
    }
    linhas = [(insumos["massa"], 120), (insumos["carne"], 120), (insumos["mucarela"], 100)]
    assert ficha(dono, cardapio["lasanha"], linhas, outros=350).status_code == 200
    assert ficha(dono, cardapio["refri"], [(insumos["refri"], 1)]).status_code == 200
    return insumos


def test_custo_do_prato_vem_da_ficha_e_acompanha_as_compras(como, cardapio, estoque):  # noqa: F811
    dono, gerente = como("dono@cantina.demo"), como("gerente@cantina.demo")
    lasanha = custo_no_cardapio(dono, "Lasanha à bolonhesa")
    assert (lasanha["custo_centavos"], lasanha["custo_pela_ficha"]) == (1442, True)
    espaguete = custo_no_cardapio(dono, "Espaguete ao sugo")  # sem ficha: fica o digitado
    assert (espaguete["custo_centavos"], espaguete["custo_pela_ficha"]) == (1000, False)
    r = dono.patch(f"/api/cardapio/itens/{lasanha['id']}", json={"custo_centavos": 1700})
    assert r.status_code == 409
    assert "ficha" in r.json()["detail"]

    fichas = {f["item_id"]: f for f in dono.get("/api/estoque").json()["fichas"]}
    assert fichas[lasanha["id"]]["custo_centavos"] == 1442
    assert fichas[lasanha["id"]]["custo_outros_centavos"] == 350

    # Tinha 3 kg de muçarela a R$ 42/kg; chegaram 7 kg por R$ 315 (R$ 45/kg): R$ 44,10/kg.
    r = gerente.post(
        "/api/estoque/compras",
        json={"insumo_id": estoque["mucarela"]["id"], "quantidade": 7000, "valor_centavos": 31500},
    )
    assert r.status_code == 201, r.text
    assert (r.json()["saldo"], r.json()["custo_centavos"]) == (10_000, 4410)
    assert custo_no_cardapio(dono, "Lasanha à bolonhesa")["custo_centavos"] == 1463

    # Preço corrigido à mão também chega no prato: massa a R$ 20/kg.
    r = gerente.patch(
        f"/api/estoque/insumos/{estoque['massa']['id']}", json={"custo_centavos": 2000}
    )
    assert r.status_code == 200
    assert custo_no_cardapio(dono, "Lasanha à bolonhesa")["custo_centavos"] == 1487


def test_quem_faz_o_que_no_estoque(como, cardapio, estoque):  # noqa: F811
    equipe, gerente, dono = (
        como("equipe@cantina.demo"),
        como("gerente@cantina.demo"),
        como("dono@cantina.demo"),
    )
    massa = estoque["massa"]["id"]

    visto = equipe.get("/api/estoque").json()
    assert (visto["mostra_valores"], visto["mostra_custo"]) == (False, False)
    assert {i["custo_centavos"] for i in visto["insumos"]} == {None}
    assert {(f["custo_centavos"], f["custo_outros_centavos"]) for f in visto["fichas"]} == {
        (None, None)
    }
    # A equipe vê a ficha (a porção) e registra perda.
    assert len(visto["fichas"]) == 2
    r = equipe.post(
        "/api/estoque/perdas", json={"insumo_id": massa, "quantidade": 300, "motivo": "Estragou"}
    )
    assert r.status_code == 201, r.text
    assert r.json()["saldo"] == 4700
    assert r.json()["custo_centavos"] is None
    r = equipe.post(
        "/api/estoque/perdas", json={"insumo_id": massa, "quantidade": 300, "motivo": "Sumiu"}
    )
    assert r.status_code == 422  # motivo fora da lista

    # O resto é da gestão.
    assert (
        equipe.post("/api/estoque/insumos", json={"nome": "Sal", "unidade": "g"}).status_code == 403
    )
    compra = {"insumo_id": massa, "quantidade": 1000, "valor_centavos": 1800}
    assert equipe.post("/api/estoque/compras", json=compra).status_code == 403
    contagem = {"itens": [{"insumo_id": massa, "quantidade": 1}]}
    assert equipe.post("/api/estoque/contagens", json=contagem).status_code == 403
    assert equipe.get(f"/api/estoque/insumos/{massa}/movimentos").status_code == 403
    assert ficha(equipe, cardapio["espaguete"], [(estoque["massa"], 100)]).status_code == 403

    # O gerente vê o preço dos ingredientes, mas não o custo dos pratos.
    visto = gerente.get("/api/estoque").json()
    assert (visto["mostra_valores"], visto["mostra_custo"]) == (True, False)
    assert {i["nome"]: i["custo_centavos"] for i in visto["insumos"]}["Massa de lasanha"] == 1800
    assert {f["custo_centavos"] for f in visto["fichas"]} == {None}
    linhas = [(estoque["massa"], 130), (estoque["carne"], 120), (estoque["mucarela"], 100)]
    assert ficha(gerente, cardapio["lasanha"], linhas, outros=0).status_code == 403
    r = ficha(gerente, cardapio["lasanha"], linhas)  # muda a receita; "outros" fica
    assert r.status_code == 200, r.text
    assert r.json()["custo_centavos"] is None
    fichas = {f["item_id"]: f for f in dono.get("/api/estoque").json()["fichas"]}
    assert fichas[cardapio["lasanha"]["id"]]["custo_outros_centavos"] == 350
    assert fichas[cardapio["lasanha"]["id"]]["custo_centavos"] == 1442 + 18  # +10 g de massa


def test_pedido_tira_do_estoque_e_o_cancelamento_devolve_ou_vira_perda(
    como,
    cardapio,  # noqa: F811
    estoque,
):
    equipe, gerente = como("equipe@cantina.demo"), como("gerente@cantina.demo")
    mesa = id_da_mesa(equipe, 1)
    r = lancar(
        equipe, mesa, (cardapio["lasanha"], 2), (cardapio["espaguete"], 1), (cardapio["refri"], 3)
    )
    assert r.status_code == 201, r.text
    # 2 lasanhas: 240 g de massa, 240 g de carne, 200 g de muçarela. Espaguete não tem ficha.
    assert saldos(gerente) == {
        "Carne moída": 3760,
        "Massa de lasanha": 4760,
        "Muçarela": 2800,
        "Refrigerante lata": 21,
    }

    # Lançou errado, antes de a cozinha fazer: tudo volta.
    lasanhas = next(i for i in r.json()["itens"] if i["item_id"] == cardapio["lasanha"]["id"])
    r = gerente.post(f"/api/pedidos/{lasanhas['id']}/cancelar", json={"motivo": "Lançado errado"})
    assert r.status_code == 200
    assert saldos(gerente)["Massa de lasanha"] == 5000
    assert saldos(gerente)["Muçarela"] == 3000

    # Depois do "Pronto", o prato foi feito: não volta, vira perda.
    r = lancar(equipe, mesa, (cardapio["lasanha"], 1))
    nova = next(
        i
        for i in r.json()["itens"]
        if i["item_id"] == cardapio["lasanha"]["id"] and i["cancelado_em"] is None
    )
    assert equipe.post(f"/api/pedidos/{nova['id']}/pronto").status_code == 200
    r = gerente.post(f"/api/pedidos/{nova['id']}/cancelar", json={"motivo": "Prato voltou"})
    assert r.status_code == 200
    assert saldos(gerente)["Massa de lasanha"] == 4880

    livro = gerente.get(f"/api/estoque/insumos/{estoque['massa']['id']}/movimentos").json()
    assert [(m["tipo"], m["quantidade"], m["motivo"]) for m in livro[:3]] == [
        ("perda", -120, "Prato cancelado"),
        ("estorno", 120, None),
        ("venda", -120, None),
    ]
    assert livro[2]["prato"] == "Lasanha à bolonhesa"
    assert livro[2]["saldo_depois"] == 4880


def test_compra_custo_medio_e_contagem(como, estoque):
    gerente, equipe = como("gerente@cantina.demo"), como("equipe@cantina.demo")
    refri, mucarela = estoque["refri"]["id"], estoque["mucarela"]["id"]

    # 24 latas a R$ 2,60 + 12 latas por R$ 33,60: 36 latas por R$ 96 = R$ 2,67 cada.
    r = gerente.post(
        "/api/estoque/compras", json={"insumo_id": refri, "quantidade": 12, "valor_centavos": 3360}
    )
    assert (r.json()["saldo"], r.json()["custo_centavos"]) == (36, 267)

    r = gerente.post(
        "/api/estoque/contagens",
        json={
            "itens": [
                {"insumo_id": mucarela, "quantidade": 2500},
                {"insumo_id": refri, "quantidade": 36},
            ]
        },
    )
    assert r.status_code == 200, r.text
    assert [
        (d["nome"], d["antes"], d["contado"], d["diferenca"]) for d in r.json()["diferencas"]
    ] == [
        ("Muçarela", 3000, 2500, -500),
        ("Refrigerante lata", 36, 36, 0),
    ]
    assert saldos(gerente)["Muçarela"] == 2500
    ultimo = gerente.get(f"/api/estoque/insumos/{mucarela}/movimentos").json()[0]
    assert (ultimo["tipo"], ultimo["quantidade"], ultimo["saldo_depois"]) == (
        "contagem",
        -500,
        2500,
    )
    assert ultimo["quem"] == "Gerente"

    # Ingrediente que saiu de uso: some para a equipe, não aceita compra, volta quando quiser.
    gerente.patch(f"/api/estoque/insumos/{refri}", json={"ativo": False})
    assert "Refrigerante lata" not in saldos(equipe)
    assert "Refrigerante lata" in saldos(gerente)
    compra = {"insumo_id": refri, "quantidade": 12, "valor_centavos": 3360}
    assert gerente.post("/api/estoque/compras", json=compra).status_code == 409
    # Nome repetido não vira outro ingrediente.
    r = gerente.post("/api/estoque/insumos", json={"nome": "Muçarela", "unidade": "g"})
    assert r.status_code == 409


def test_um_restaurante_nao_ve_nem_mexe_no_estoque_do_outro(
    como,
    cardapio,  # noqa: F811
    estoque,
):
    vizinha = como("dono@vizinha.demo")
    assert vizinha.get("/api/estoque").json() == {
        "insumos": [],
        "fichas": [],
        "mostra_valores": True,
        "mostra_custo": True,
    }
    massa = estoque["massa"]["id"]
    assert (
        vizinha.post(
            "/api/estoque/compras", json={"insumo_id": massa, "quantidade": 1000}
        ).status_code
        == 404
    )
    perda = {"insumo_id": massa, "quantidade": 1000, "motivo": "Outro"}
    assert vizinha.post("/api/estoque/perdas", json=perda).status_code == 404
    assert vizinha.get(f"/api/estoque/insumos/{massa}/movimentos").status_code == 404
    assert vizinha.patch(f"/api/estoque/insumos/{massa}", json={"ativo": False}).status_code == 404
    contagem = {"itens": [{"insumo_id": massa, "quantidade": 0}]}
    assert vizinha.post("/api/estoque/contagens", json=contagem).status_code == 404
    assert ficha(vizinha, cardapio["lasanha"], []).status_code == 404

    # Nem usar o ingrediente da Cantina na ficha do próprio prato.
    pizzas = vizinha.post("/api/cardapio/categorias", json={"nome": "Pizzas"}).json()
    pizza = vizinha.post(
        "/api/cardapio/itens",
        json={"categoria_id": pizzas["id"], "nome": "Pizza de muçarela", "preco_centavos": 5000},
    ).json()
    assert ficha(vizinha, pizza, [(estoque["mucarela"], 200)]).status_code == 404

    # E nada disso mexeu no estoque da Cantina.
    assert saldos(como("gerente@cantina.demo"))["Massa de lasanha"] == 5000
    # Admin da GIRO precisa dizer de qual restaurante quer ver.
    assert como("admin@giro.demo").get("/api/estoque").status_code == 400
