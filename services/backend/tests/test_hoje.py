"""A tela "Hoje": a noite até agora e o que pede atenção, com custo só para o dono."""

from datetime import timedelta

from sqlalchemy import update

from giro.banco import agora
from giro.modelos import ItemPedido
from tests.test_cardapio import cardapio, id_da_mesa, lancar  # noqa: F401 (fixture)
from tests.test_estoque import estoque  # noqa: F401 (fixture)
from tests.test_perdas import semana  # noqa: F401 (fixture)


def tipos(resposta):
    return [p["tipo"] for p in resposta.json()["pendencias"]]


def test_hoje_e_da_gestao_e_de_cada_restaurante(como, semana):  # noqa: F811
    assert como("equipe@cantina.demo").get("/api/hoje").status_code == 403
    assert como("admin@giro.demo").get("/api/hoje").status_code == 400
    vizinha = como("dono@vizinha.demo").get("/api/hoje").json()
    assert (vizinha["pendencias"], vizinha["noite"]["vendeu_centavos"]) == ([], 0)

    dono = como("dono@cantina.demo").get("/api/hoje").json()
    # Duas lasanhas a R$ 62 lançadas hoje, numa mesa que abriu a visita pelo pedido.
    assert dono["noite"]["vendeu_centavos"] == 12_400
    assert dono["costuma"] is None  # restaurante novo: sem noites iguais para comparar
    assert dono["esperar"][0].startswith("Hoje é ")


def test_custo_nas_pendencias_so_para_o_dono(como, semana):  # noqa: F811
    dono = como("dono@cantina.demo").get("/api/hoje")
    perdas = next(p for p in dono.json()["pendencias"] if p["tipo"] == "perdas")
    assert perdas == {
        "tipo": "perdas",
        "texto": "Nos últimos 7 dias escaparam R$ 34 do estoque. O que mais pesou: muçarela.",
        "href": "/estoque?aba=perdas",
        "urgente": False,
    }
    gerente = como("gerente@cantina.demo").get("/api/hoje")
    assert "perdas" not in tipos(gerente) and "preco" not in tipos(gerente)
    assert "R$" not in " ".join(p["texto"] for p in gerente.json()["pendencias"])


def test_cozinha_atrasada_e_o_que_acabou_viram_pendencia(app, como, cardapio, estoque):  # noqa: F811
    equipe, gerente = como("equipe@cantina.demo"), como("gerente@cantina.demo")
    assert tipos(gerente.get("/api/hoje")) == []
    assert lancar(equipe, id_da_mesa(equipe, 3), (cardapio["lasanha"], 2)).status_code == 201
    assert "cozinha" not in tipos(gerente.get("/api/hoje"))  # acabou de lançar: não é atraso

    with app.state.sessoes() as db:  # o pedido está esperando há 34 minutos
        db.execute(update(ItemPedido).values(lancado_em=agora() - timedelta(minutes=34)))
        db.commit()
    acabou = equipe.post(
        f"/api/cardapio/itens/{cardapio['espaguete']['id']}/disponivel", json={"disponivel": False}
    )
    assert acabou.status_code == 200
    pendencias = gerente.get("/api/hoje").json()["pendencias"]
    assert pendencias[0] == {
        "tipo": "cozinha",
        "texto": "2 itens esperam na cozinha há mais de 20 min. O mais antigo é da mesa 3, "
        "há 34 min.",
        "href": "/cozinha",
        "urgente": True,
    }
    assert pendencias[-1] == {
        "tipo": "acabou",
        "texto": 'Está como "acabou": espaguete ao sugo. Se chegou mercadoria, volte para '
        '"tem hoje".',
        "href": "/cardapio",
        "urgente": False,
    }


def test_estoque_zerado_com_prato_a_venda_e_urgente(como, cardapio, estoque):  # noqa: F811
    gerente = como("gerente@cantina.demo")
    zerar = {"itens": [{"insumo_id": estoque["massa"]["id"], "quantidade": 0}]}
    assert gerente.post("/api/estoque/contagens", json=zerar).status_code == 200
    pendencias = gerente.get("/api/hoje").json()["pendencias"]
    zerado = next(p for p in pendencias if p["tipo"] == "zerado")
    assert zerado["urgente"] is True
    assert zerado["texto"] == (
        'Pela conta do estoque, acabou: massa de lasanha. Ainda como "tem hoje": '
        "lasanha à bolonhesa. Confira a geladeira e, se faltar, marque acabou."
    )
    # Marcou a lasanha como acabou: o estoque zerado deixa de pedir atenção.
    lasanha = cardapio["lasanha"]["id"]
    gerente.post(f"/api/cardapio/itens/{lasanha}/disponivel", json={"disponivel": False})
    assert "zerado" not in tipos(gerente.get("/api/hoje"))
