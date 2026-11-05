"""Lista de compras e "até quando dá": previsão pelas últimas 4 noites iguais, o que já saiu
hoje, folga, dias de compra, perfis, isolamento e o Copiloto falando do estoque."""

import json
from datetime import datetime, time, timedelta

import pytest
from sqlalchemy import select

from giro.banco import agora
from giro.dominio.indicadores import FUSO, noite_de
from giro.modelos import ItemPedido, Mesa, Ocupacao, Restaurante
from tests.test_cardapio import cardapio, id_da_mesa, lancar  # noqa: F401 (fixture)
from tests.test_copiloto import IADeMentira, resposta_da_ia
from tests.test_estoque import estoque  # noqa: F401 (fixture)

DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


@pytest.fixture
def hoje():
    return noite_de(agora())


@pytest.fixture
def historico(app, cardapio, hoje):  # noqa: F811
    """4 semanas de lasanha: 10 por noite. Nas 4 noites iguais a hoje, 12, 40 (feriado), 8 e
    10: a mediana é 11 e o feriado não puxa a conta."""
    iguais = {28: 12, 21: 40, 14: 8, 7: 10}
    with app.state.sessoes() as db:
        cantina = db.scalar(select(Restaurante).where(Restaurante.nome == "Cantina do Marcos"))
        mesa = db.scalar(select(Mesa).where(Mesa.restaurante_id == cantina.id, Mesa.numero == 2))
        for dias_atras in range(1, 29):
            em = datetime.combine(hoje - timedelta(days=dias_atras), time(20), FUSO)
            visita = Ocupacao(
                restaurante_id=cantina.id,
                mesa_id=mesa.id,
                sentou_em=em,
                atendida_em=em,
                saiu_em=em + timedelta(hours=1),
                liberada_em=em + timedelta(hours=1, minutes=5),
                pessoas=4,
            )
            db.add(visita)
            db.flush()
            db.add(
                ItemPedido(
                    restaurante_id=cantina.id,
                    ocupacao_id=visita.id,
                    mesa_id=mesa.id,
                    item_id=cardapio["lasanha"]["id"],
                    nome="Lasanha à bolonhesa",
                    preco_unit_centavos=6200,
                    quantidade=iguais.get(dias_atras, 10),
                    lancado_em=em,
                )
            )
        db.commit()
        return cantina.id


def comprar_em(dono, restaurante_id, *dias):
    r = dono.patch(
        f"/api/restaurantes/{restaurante_id}",
        json={"dias_compra": ",".join(str(d.weekday()) for d in dias)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["dias_compra"] == ",".join(sorted({str(d.weekday()) for d in dias}))


def test_compra_de_hoje_conta_com_o_que_ainda_falta_vender(
    como,
    cardapio,  # noqa: F811
    estoque,  # noqa: F811
    historico,
    hoje,
):
    dono, gerente, equipe = (
        como("dono@cantina.demo"),
        como("gerente@cantina.demo"),
        como("equipe@cantina.demo"),
    )
    comprar_em(dono, historico, hoje)  # só hoje: a compra cobre a semana inteira
    # Já saíram 3 lasanhas hoje: das 11 previstas, faltam 8. Com 10 nas outras 6 noites, 68.
    assert lancar(equipe, id_da_mesa(equipe, 1), (cardapio["lasanha"], 3)).status_code == 201

    lista = gerente.get("/api/estoque/compras").json()
    assert (lista["compra"], lista["antes"], len(lista["cobre"])) == (hoje.isoformat(), [], 7)
    assert (lista["folga_pct"], lista["folga_padrao_pct"]) == (15, 15)
    linhas = {linha["nome"]: linha for linha in lista["comprar"]}
    assert list(linhas) == ["Carne moída", "Massa de lasanha", "Muçarela"]
    massa = linhas["Massa de lasanha"]
    # 68 × 120 g = 8160 g; com 15%, 9384 g; tem 4640 g; faltam 4744 g: 5 pacotes de 1 kg.
    assert (massa["tem"], massa["precisa"], massa["com_folga"], massa["falta"]) == (
        4640,
        8160,
        9384,
        4744,
    )
    assert (massa["embalagens"], massa["quantidade"], massa["valor_centavos"]) == (5, 5000, 9000)
    assert massa["pratos"] == [
        {"item_id": cardapio["lasanha"]["id"], "nome": "Lasanha à bolonhesa", "por_porcao": 120,
         "pratos": 68}
    ]  # fmt: skip
    assert lista["nada_a_comprar"] == ["Refrigerante lata"]
    assert lista["total_centavos"] == 9000 + 22800 + 25200

    # O porquê: as 4 noites iguais a hoje deram 11, e 3 já saíram.
    lasanha = next(p for p in lista["pratos"] if p["nome"] == "Lasanha à bolonhesa")
    noite = lasanha["noites"][0]
    assert (noite["previstos"], noite["ultimas"], noite["ja_vendidos"]) == (11, [12, 40, 8, 10], 3)

    # Fim de semana de feriado: a folga muda só nesta conta.
    sem_folga = gerente.get("/api/estoque/compras?folga=0").json()
    assert sem_folga["comprar"][1]["embalagens"] == 4  # 8160 − 4640 = 3520 g
    assert gerente.get("/api/estoque/compras?folga=101").status_code == 422

    # No estoque, até quando dá: 4640 g menos 960 hoje e 1200 por noite acaba em 4 noites.
    insumos = {i["nome"]: i for i in equipe.get("/api/estoque").json()["insumos"]}
    assert insumos["Massa de lasanha"]["situacao"] == "comprar"
    assert insumos["Massa de lasanha"]["acaba_em"] == (hoje + timedelta(days=4)).isoformat()
    assert (insumos["Refrigerante lata"]["situacao"], insumos["Refrigerante lata"]["acaba_em"]) == (
        "tem",
        None,
    )


def test_compra_daqui_a_dois_dias_desconta_o_que_sai_antes(
    como,
    cardapio,  # noqa: F811
    estoque,  # noqa: F811
    historico,
    hoje,
):
    dono, gerente = como("dono@cantina.demo"), como("gerente@cantina.demo")
    compra = hoje + timedelta(days=2)
    comprar_em(dono, historico, compra)
    lista = gerente.get("/api/estoque/compras").json()
    assert lista["compra"] == compra.isoformat()
    assert lista["antes"] == [hoje.isoformat(), (hoje + timedelta(days=1)).isoformat()]
    massa = next(linha for linha in lista["comprar"] if linha["nome"] == "Massa de lasanha")
    # Até a compra saem 11 + 10 lasanhas (2520 g): sobram 2480 g. A compra cobre 7 noites:
    # 5 × 10, mais 11 (o mesmo dia da semana de hoje) e 10 = 71 lasanhas = 8520 g.
    assert (massa["sai_ate_compra"], massa["sobra"], massa["precisa"]) == (2520, 2480, 8520)
    assert massa["embalagens"] == 8  # 9798 − 2480 = 7318 g


def test_lista_de_compras_e_da_gestao_e_de_cada_restaurante(
    como,
    estoque,  # noqa: F811
    historico,
):
    assert como("equipe@cantina.demo").get("/api/estoque/compras").status_code == 403
    vizinha = como("dono@vizinha.demo").get("/api/estoque/compras").json()
    assert (vizinha["comprar"], vizinha["nada_a_comprar"]) == ([], [])
    assert como("admin@giro.demo").get("/api/estoque/compras").status_code == 400
    r = como("dono@cantina.demo").patch(
        f"/api/restaurantes/{historico}", json={"dias_compra": "1,9"}
    )
    assert r.status_code == 422
    r = como("gerente@cantina.demo").patch(
        f"/api/restaurantes/{historico}", json={"folga_compra_pct": 20}
    )
    assert r.status_code == 403  # Ajustes são do dono


def test_copiloto_diz_o_que_comprar_e_o_que_acaba_sem_falar_de_reais(
    app,
    como,
    cardapio,  # noqa: F811
    estoque,  # noqa: F811
    historico,
    hoje,
):
    dono = como("dono@cantina.demo")
    comprar_em(dono, historico, hoje)
    dia = DIAS[hoje.weekday()]

    r = dono.post("/api/copiloto/perguntar", json={"pergunta": "O que eu preciso comprar?"})
    resposta = r.json()["resposta"]
    assert resposta.startswith(f"Para a compra de {dia} (hoje)")
    # Sem nada vendido hoje: 71 lasanhas = 8520 g; com 15%, 9798 g; tem 5 kg: 5 pacotes.
    assert "Massa de lasanha: 5 kg" in resposta
    r = dono.post("/api/copiloto/perguntar", json={"pergunta": "O que está acabando?"})
    assert "Precisa entrar na compra" in r.json()["resposta"]
    assert "massa de lasanha" in r.json()["resposta"]

    briefing = dono.get("/api/copiloto/briefing").json()
    assert any(d.startswith("Hoje é dia de compra: 3 itens") for d in briefing["dicas"])

    ia = IADeMentira(resposta=resposta_da_ia("Compre massa."))
    app.state.copiloto._cliente = ia
    dono.post("/api/copiloto/perguntar", json={"pergunta": "O que comprar?"})
    conteudo = ia.pedidos[-1]["messages"][0]["content"]
    numeros = json.loads(conteudo.split("\n", 1)[1].split("\n\nPergunta do dono:")[0])
    massa = next(i for i in numeros["estoque"]["ingredientes"] if i["nome"] == "Massa de lasanha")
    assert massa == {"nome": "Massa de lasanha", "tem": "5 kg", "acaba": massa["acaba"],
                     "comprar": "5 kg"}  # fmt: skip
    texto = json.dumps(numeros["estoque"], ensure_ascii=False)
    assert "R$" not in texto and "reais" not in texto and "custo" not in texto
