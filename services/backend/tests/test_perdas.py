"""Perdas do estoque: custo pela ficha contra o de verdade, o que escapou, perdas por motivo,
curva ABC, o preço que subiu (com aviso no celular do dono), perfis, isolamento e Copiloto."""

from datetime import timedelta

import pytest
from sqlalchemy import select, update

from giro.banco import agora
from giro.modelos import Insumo, MovimentoEstoque
from giro.servicos.perdas import contagem_atrasada
from tests.test_cardapio import cardapio, id_da_mesa, lancar  # noqa: F401 (fixture)
from tests.test_copiloto import PushDeMentira
from tests.test_estoque import estoque, saldos  # noqa: F401 (fixture)


@pytest.fixture
def semana(como, cardapio, estoque):  # noqa: F811
    """Uma semana na Cantina: 2 lasanhas vendidas (200 g de muçarela), 300 g de muçarela que
    caíram no chão e a contagem achando mais 500 g a menos que a conta."""
    equipe, gerente = como("equipe@cantina.demo"), como("gerente@cantina.demo")
    assert lancar(equipe, id_da_mesa(equipe, 1), (cardapio["lasanha"], 2)).status_code == 201
    perda = {"insumo_id": estoque["mucarela"]["id"], "quantidade": 300, "motivo": "Caiu ou queimou"}
    assert equipe.post("/api/estoque/perdas", json=perda).status_code == 201
    contagem = {
        "itens": [
            {"insumo_id": estoque["mucarela"]["id"], "quantidade": 2000},  # a conta dizia 2500
            {"insumo_id": estoque["massa"]["id"], "quantidade": 4760},  # bateu
        ]
    }
    assert gerente.post("/api/estoque/contagens", json=contagem).status_code == 200


def test_custo_pela_ficha_e_de_verdade(como, semana):
    perdas = como("dono@cantina.demo").get("/api/estoque/perdas").json()
    # Vendeu 2 × R$ 62. Pela ficha, cada lasanha custa R$ 14,42.
    assert (perdas["vendeu_centavos"], perdas["custo_pela_ficha_centavos"]) == (12_400, 2884)
    # Escaparam 800 g de muçarela a R$ 42/kg: 300 g registradas e 500 g sem registro.
    assert (perdas["registrada_centavos"], perdas["sem_registro_centavos"]) == (1260, 2100)
    assert (perdas["escapou_centavos"], perdas["custo_de_verdade_centavos"]) == (3360, 2884 + 3360)
    assert perdas["ultima_contagem"] is not None
    assert [linha["nome"] for linha in perdas["linhas"]] == ["Muçarela"]  # a massa bateu
    mucarela = perdas["linhas"][0]
    assert (mucarela["pela_ficha"], mucarela["registrada"], mucarela["sem_registro"]) == (
        200,
        300,
        500,
    )
    assert (mucarela["saiu"], mucarela["valor_escapou_centavos"]) == (1000, 3360)
    assert (mucarela["prato"], mucarela["por_porcao"]) == ("Lasanha à bolonhesa", 100)
    assert perdas["por_motivo"] == [
        {
            "motivo": "Caiu ou queimou",
            "valor_centavos": 1260,
            "itens": [{"nome": "Muçarela", "unidade": "g", "quantidade": 300}],
        }
    ]
    # Curva ABC das 4 semanas: muçarela R$ 42 e carne R$ 9,12 somam mais de 80%.
    assert perdas["curva_a"] == ["Carne moída", "Muçarela"]


def test_contagem_depois_de_um_mes_nao_cai_inteira_na_semana(app, como, estoque):  # noqa: F811
    """O estoque entrou há 28 dias e só hoje alguém contou: falta 1 kg de muçarela (R$ 42).
    Isso sumiu ao longo do mês: a semana leva um quarto, e não o mês inteiro."""
    with app.state.sessoes() as db:
        db.execute(update(MovimentoEstoque).values(em=agora() - timedelta(days=28)))
        db.commit()
    contagem = {"itens": [{"insumo_id": estoque["mucarela"]["id"], "quantidade": 2000}]}
    assert como("gerente@cantina.demo").post("/api/estoque/contagens", json=contagem).json()
    dono = como("dono@cantina.demo")
    semana_, mes = (
        dono.get(f"/api/estoque/perdas?periodo={periodo}").json() for periodo in ("semana", "mes")
    )
    assert (semana_["linhas"][0]["sem_registro"], semana_["sem_registro_centavos"]) == (250, 1050)
    assert (mes["linhas"][0]["sem_registro"], mes["sem_registro_centavos"]) == (1000, 4200)


def test_ingrediente_fora_de_uso_continua_nas_perdas(como, semana, estoque):  # noqa: F811
    """Tirar o ingrediente de uso não apaga do relatório do dono o que escapou dele."""
    dono, gerente = como("dono@cantina.demo"), como("gerente@cantina.demo")
    antes = dono.get("/api/estoque/perdas").json()
    fora = gerente.patch(f"/api/estoque/insumos/{estoque['mucarela']['id']}", json={"ativo": False})
    assert fora.status_code == 200
    depois = dono.get("/api/estoque/perdas").json()
    assert depois["escapou_centavos"] == antes["escapou_centavos"] == 3360
    assert depois["por_motivo"] == antes["por_motivo"]
    # Fora de uso, sai da curva e do lembrete de contagem, mas a linha continua lá.
    linhas = [(linha["nome"], linha["escapou"], linha["curva"]) for linha in depois["linhas"]]
    assert linhas == [("Muçarela", 800, None)]
    assert "Muçarela" in antes["curva_a"] and "Muçarela" not in depois["curva_a"]


def test_lembrete_de_contagem_conta_em_noites_como_o_painel(app, semana):
    """Contou há 7 noites: ainda não é "mais de uma semana". Na oitava, o lembrete volta."""
    with app.state.sessoes() as db:
        cantina = db.scalars(select(Insumo.restaurante_id)).first()
        atrasados = lambda quando: [i.nome for i in contagem_atrasada(db, cantina, quando)]  # noqa: E731
        assert "Muçarela" not in atrasados(agora() + timedelta(days=7))
        assert "Muçarela" in atrasados(agora() + timedelta(days=8))


def test_curva_e_contagem_aparecem_no_estoque(como, semana):
    insumos = {
        i["nome"]: i for i in como("gerente@cantina.demo").get("/api/estoque").json()["insumos"]
    }
    assert (insumos["Muçarela"]["curva"], insumos["Massa de lasanha"]["curva"]) == ("A", "B")
    assert insumos["Muçarela"]["contado_em"] is not None
    # O "tem agora" do cadastro é o saldo de partida: não é contagem, nem sobra.
    assert insumos["Refrigerante lata"]["contado_em"] is None
    livro = (
        como("gerente@cantina.demo")
        .get(f"/api/estoque/insumos/{insumos['Refrigerante lata']['id']}/movimentos")
        .json()
    )
    assert [m["tipo"] for m in livro] == ["inicial"]


def test_compra_mais_cara_avisa_o_dono_e_aparece_nas_perdas(app, como, estoque):  # noqa: F811
    push = PushDeMentira()
    app.state.servico.push = push
    gerente, dono = como("gerente@cantina.demo"), como("dono@cantina.demo")
    mucarela = estoque["mucarela"]["id"]

    def comprar(valor):
        r = gerente.post(
            "/api/estoque/compras",
            json={"insumo_id": mucarela, "quantidade": 10_000, "valor_centavos": valor},
        )
        assert r.status_code == 201, r.text

    comprar(42_000)  # R$ 42/kg, igual ao preço de antes: nada a avisar
    assert push.enviados == []
    comprar(48_300)  # R$ 48,30/kg: subiu 15%
    assert [(titulo, corpo) for _, titulo, corpo in push.enviados] == [
        (
            "O preço subiu",
            "Muçarela subiu 15%: de R$ 42/kg para R$ 48,30/kg. Lasanha à bolonhesa passou a "
            "custar R$ 0,63 a mais por prato.",
        )
    ]
    precos = dono.get("/api/estoque/perdas").json()["precos"]
    assert [(p["nome"], p["antes_centavos"], p["agora_centavos"], p["pct"]) for p in precos] == [
        ("Muçarela", 4200, 4830, 15)
    ]
    assert precos[0]["pratos"] == [{"nome": "Lasanha à bolonhesa", "a_mais_centavos": 63}]


def test_perdas_sao_so_do_dono_e_de_cada_restaurante(como, semana):
    assert como("gerente@cantina.demo").get("/api/estoque/perdas").status_code == 403
    assert como("equipe@cantina.demo").get("/api/estoque/perdas").status_code == 403
    vizinha = como("dono@vizinha.demo").get("/api/estoque/perdas").json()
    assert (vizinha["linhas"], vizinha["escapou_centavos"], vizinha["vendeu_centavos"]) == (
        [],
        0,
        0,
    )
    assert como("admin@giro.demo").get("/api/estoque/perdas").status_code == 400
    assert como("dono@cantina.demo").get("/api/estoque/perdas?periodo=ano").status_code == 422
    assert como("dono@cantina.demo").get("/api/estoque/perdas?periodo=mes").status_code == 200


def test_copiloto_fala_das_perdas_em_reais_so_para_o_dono(como, semana):
    pergunta = {"pergunta": "Onde estou perdendo no estoque?"}
    resposta = como("dono@cantina.demo").post("/api/copiloto/perguntar", json=pergunta).json()
    assert resposta["resposta"].startswith("Nos últimos 7 dias escaparam R$ 34 do estoque.")
    assert "muçarela (R$ 34)" in resposta["resposta"]
    resposta = como("gerente@cantina.demo").post("/api/copiloto/perguntar", json=pergunta).json()
    assert resposta["resposta"].startswith("Perdas em reais ficam com o dono.")
    assert "muçarela 800 g" in resposta["resposta"]
    assert "R$" not in resposta["resposta"]


def test_para_a_ia_vao_so_quantidades_das_perdas(app, como, semana):
    import json

    from tests.test_copiloto import IADeMentira, resposta_da_ia

    ia = IADeMentira(resposta=resposta_da_ia("Confira a porção da muçarela."))
    app.state.copiloto._cliente = ia
    como("dono@cantina.demo").post(
        "/api/copiloto/perguntar", json={"pergunta": "Onde estou perdendo no estoque?"}
    )
    conteudo = ia.pedidos[-1]["messages"][0]["content"]
    numeros = json.loads(conteudo.split("\n", 1)[1].split("\n\nPergunta do dono:")[0])
    perdas = numeros["perdas_do_estoque_7_dias"]
    assert perdas["ingredientes"] == [
        {
            "nome": "Muçarela",
            "escapou": "800 g",
            "sem_registro": "500 g",
            "perda_registrada": "300 g",
        }
    ]
    texto = json.dumps(perdas, ensure_ascii=False)
    assert "R$" not in texto and "reais" not in texto and "%" not in texto
