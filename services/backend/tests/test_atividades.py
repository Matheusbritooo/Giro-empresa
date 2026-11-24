"""Histórico de quem fez o quê (só o dono, com o nome de quem mexeu) e primeiros passos (o que
falta para o GIRO trabalhar, visto pelo banco)."""

from datetime import timedelta

from sqlalchemy import select

from giro.banco import agora
from giro.modelos import Mesa, Ocupacao
from giro.servicos.atividades import reais
from giro.servicos.primeiros_passos import restaurante_novo
from tests.test_cardapio import cardapio, id_da_mesa, lancar  # noqa: F401 (fixture)
from tests.test_estoque import estoque  # noqa: F401 (fixture)


def historico(cliente, **filtros):
    resposta = cliente.get("/api/atividades", params=filtros)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def textos(cliente, **filtros):
    return [(a["quem"], a["texto"]) for a in historico(cliente, **filtros)["atividades"]]


def test_mudanca_de_preco_acabou_e_cancelamento_ficam_com_o_nome_de_quem_fez(
    como,
    cardapio,  # noqa: F811
):
    dono, gerente, equipe = (
        como("dono@cantina.demo"),
        como("gerente@cantina.demo"),
        como("equipe@cantina.demo"),
    )
    lasanha = cardapio["lasanha"]
    gerente.patch(f"/api/cardapio/itens/{lasanha['id']}", json={"preco_centavos": 6450})
    gerente.patch(f"/api/cardapio/itens/{lasanha['id']}", json={"preco_centavos": 6450})  # igual
    dono.patch(f"/api/cardapio/itens/{cardapio['espaguete']['id']}", json={"custo_centavos": 1150})
    equipe.post(
        f"/api/cardapio/itens/{cardapio['refri']['id']}/disponivel", json={"disponivel": False}
    )
    pedido = lancar(equipe, id_da_mesa(equipe, 2), (lasanha, 2)).json()
    item = pedido["itens"][0]
    gerente.post(f"/api/pedidos/{item['id']}/cancelar", json={"motivo": "Lançado errado"})

    linhas = textos(dono)
    assert linhas[:4] == [
        ("Gerente", "Cancelou 2 Lasanha à bolonhesa da mesa 2: lançado errado"),
        ("Equipe", 'Marcou Refrigerante lata como "acabou"'),
        ("Dono", "Custo de Espaguete ao sugo: de R$ 10 para R$ 11,50"),
        ("Gerente", "Preço de Lasanha à bolonhesa: de R$ 62 para R$ 64,50"),
    ]
    # O cardápio montado no começo também ficou: categorias e itens, pelo dono.
    assert ("Dono", "Criou o item Lasanha à bolonhesa, a R$ 62") in linhas
    assert ("Dono", "Criou a categoria Massas") in linhas

    # Filtros: por assunto e por pessoa.
    assert [t for _, t in textos(dono, grupo="pedido")] == [linhas[0][1]]
    pessoas = historico(dono)["pessoas"]
    assert [p["nome"] for p in pessoas] == ["Dono", "Equipe", "Gerente"]
    gerente_id = next(p["id"] for p in pessoas if p["nome"] == "Gerente")
    assert {q for q, _ in textos(dono, pessoa=gerente_id)} == {"Gerente"}


def test_estoque_equipe_ajustes_e_mesas_tambem_entram(como, estoque):  # noqa: F811
    dono, gerente = como("dono@cantina.demo"), como("gerente@cantina.demo")
    restaurante = dono.get("/api/auth/sessao").json()["restaurante"]
    mucarela = estoque["mucarela"]
    gerente.post(
        "/api/estoque/compras",
        json={"insumo_id": mucarela["id"], "quantidade": 2000, "valor_centavos": 9000},
    )
    como("equipe@cantina.demo").post(
        "/api/estoque/perdas",
        json={"insumo_id": mucarela["id"], "quantidade": 300, "motivo": "Venceu"},
    )
    gerente.post(
        "/api/estoque/contagens",
        json={
            "itens": [
                {"insumo_id": mucarela["id"], "quantidade": 4500},
                {"insumo_id": estoque["refri"]["id"], "quantidade": 24},
            ]
        },
    )
    dono.patch(
        f"/api/restaurantes/{restaurante['id']}",
        json={"ticket_medio_centavos": 9000, "dias_compra": "1,4", "alerta_visita_min": 0},
    )
    usuarios = dono.get("/api/usuarios").json()
    garcom = next(u for u in usuarios if u["papel"] == "equipe")
    dono.patch(f"/api/usuarios/{garcom['id']}", json={"papel": "gerente"})
    gerente.patch(f"/api/mesas/{id_da_mesa(gerente, 3)}", json={"lugares": 6})
    gerente.post(f"/api/mesas/{id_da_mesa(gerente, 3)}/qr/trocar")

    linhas = [t for _, t in textos(dono)]
    assert linhas[:7] == [
        "Trocou o QR da mesa 3 (o impresso antes parou de funcionar)",
        "Lugares da mesa 3: de 4 para 6",
        "Mudou Equipe de equipe do salão para gerente",
        "Mudou o alerta de mesa sem visita de 15 min para desligado e "
        "o gasto médio por pessoa de R$ 85 para R$ 90",
        "Contou 2 ingredientes: achou menos em Muçarela",
        "Registrou perda de 300 g de Muçarela: venceu",
        "Lançou a compra de 2 kg de Muçarela por R$ 90",
    ]
    assert "Cadastrou o ingrediente Muçarela, com 3 kg" in linhas
    assert any(t.startswith("Mudou a ficha de Lasanha à bolonhesa: 3 ingredientes") for t in linhas)
    # Nada de senha, e-mail ou token no histórico.
    assert not any("@" in t or "senha" in t.lower() or "cam_" in t for t in linhas)


def test_historico_e_so_do_dono_de_cada_restaurante(como, cardapio):  # noqa: F811
    assert como("gerente@cantina.demo").get("/api/atividades").status_code == 403
    assert como("equipe@cantina.demo").get("/api/atividades").status_code == 403
    assert historico(como("dono@vizinha.demo"))["atividades"] == []
    assert historico(como("dono@cantina.demo"), periodo="trimestre")["atividades"]
    assert como("dono@cantina.demo").get("/api/atividades?periodo=ano").status_code == 422


def test_primeiros_passos_seguem_o_que_o_restaurante_ja_tem(como, cardapio):  # noqa: F811
    dono, gerente = como("dono@cantina.demo"), como("gerente@cantina.demo")
    passos = dono.get("/api/primeiros-passos").json()
    feitos = {p["id"]: p["feito"] for p in passos["passos"]}
    # A Cantina dos testes já tem mesas, cardápio e equipe; falta o resto.
    assert feitos == {
        "mesas": True,
        "camera": False,
        "desenho": False,
        "cardapio": True,
        "equipe": True,
        "ajustes": False,
        "fichas": False,
        "qr": False,
    }
    assert (passos["novo"], passos["feitos"], passos["total"]) == (True, 3, 8)

    # O gerente vê os passos do dono sem o link (é o dono quem faz).
    links = {p["id"]: p["href"] for p in gerente.get("/api/primeiros-passos").json()["passos"]}
    assert (links["camera"], links["equipe"], links["qr"]) == (None, None, "/mesas/qr")

    # Abrir os QR e conferir os ajustes marca os passos sozinho.
    gerente.get("/api/mesas/qr")
    restaurante = dono.get("/api/auth/sessao").json()["restaurante"]
    dono.patch(f"/api/restaurantes/{restaurante['id']}", json={"abre_as": "18:30"})
    feitos = {p["id"]: p["feito"] for p in dono.get("/api/primeiros-passos").json()["passos"]}
    assert feitos["qr"] and feitos["ajustes"]

    # A vizinha tem só uma mesa: o resto falta. A equipe não abre.
    vizinha = como("dono@vizinha.demo").get("/api/primeiros-passos").json()
    assert vizinha["feitos"] == 1
    assert como("equipe@cantina.demo").get("/api/primeiros-passos").status_code == 403


def test_restaurante_que_ja_roda_ha_semanas_nao_e_mais_novo(app):
    momento = agora()
    with app.state.sessoes() as db:
        mesa = db.scalars(select(Mesa).where(Mesa.restaurante_id == 1)).first()
        assert restaurante_novo(db, 1, momento)
        db.add(Ocupacao(restaurante_id=1, mesa_id=mesa.id, sentou_em=momento - timedelta(days=13)))
        db.flush()
        assert restaurante_novo(db, 1, momento)  # duas semanas ainda é começo
        db.add(Ocupacao(restaurante_id=1, mesa_id=mesa.id, sentou_em=momento - timedelta(days=15)))
        db.flush()
        assert not restaurante_novo(db, 1, momento)
        assert restaurante_novo(db, 2, momento)  # a vizinha não tem visita nenhuma


def test_texto_de_dinheiro():
    assert (reais(6200), reais(1442), reais(123_456_78), reais(None)) == (
        "R$ 62",
        "R$ 14,42",
        "R$ 123.456,78",
        "sem valor",
    )
