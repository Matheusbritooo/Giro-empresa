"""Planilha do caixa: leitura de formatos diferentes, prévia, importação (que troca as noites
já importadas) e a conferência com os pedidos do GIRO. Nenhuma coluna além de data, produto,
quantidade e valor é guardada."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from giro.banco import agora
from giro.dominio.caixa import ErroPlanilha, ler_dinheiro, ler_planilha, sugerir_item
from giro.dominio.indicadores import noite_de
from giro.modelos import VendaCaixa
from tests.test_cardapio import cardapio, id_da_mesa, lancar  # noqa: F401 (fixture)

PLANILHA = (
    "﻿Data;Hora;Cliente;CPF;Produto;Qtde;Valor Unit.;Valor Total;Forma Pgto\n"
    "21/11/2026;21:40;Fulano;123.456.789-00;LASANHA A BOLONHESA;2;62,00;124,00;Pix\n"
    "21/11/2026;23:10;;;Refrigerante Lata;3;7,00;21,00;Dinheiro\n"
    "22/11/2026;00:30;;;Lasanha à Bolonhesa;1;62,00;62,00;Crédito\n"  # ainda é a noite de 21
    "22/11/2026;20:00;;;Couvert artístico;2;15,00;30,00;Crédito\n"
    ";;;;;;;;\n"
    "22/11/2026;20:05;;;;1;5,00;5,00;Pix\n"  # sem produto: ignorada
)


def test_le_a_planilha_do_caixa_e_ignora_o_resto():
    leitura = ler_planilha(PLANILHA)
    assert leitura.colunas == {
        "data": "Data",
        "hora": "Hora",
        "nome": "Produto",
        "quantidade": "Qtde",
        "total": "Valor Total",
        "unitario": "Valor Unit.",
    }
    assert [
        (lin.noite.day, lin.nome, lin.quantidade, lin.valor_centavos) for lin in leitura.linhas
    ] == [
        (21, "LASANHA A BOLONHESA", 2, 12_400),
        (21, "Refrigerante Lata", 3, 2_100),
        (21, "Lasanha à Bolonhesa", 1, 6_200),
        (22, "Couvert artístico", 2, 3_000),
    ]
    assert leitura.ignoradas == 1
    assert "Fulano" not in repr(leitura) and "123.456" not in repr(leitura)


def test_outros_formatos_de_caixa():
    virgula = (
        "data_venda,descricao,quantidade,preco_unitario\n"
        "2026-11-21 21:00:00,Chopp 300 ml,4,12.50\n"
        "2026-11-21,Água sem gás,1,5\n"
    )
    leitura = ler_planilha(virgula)
    assert [(lin.nome, lin.valor_centavos) for lin in leitura.linhas] == [
        ("Chopp 300 ml", 5_000),
        ("Água sem gás", 500),
    ]
    so_data = ler_planilha("Dia;Item;Total\n21/11/2026;Pudim;R$ 18,00\n")
    assert so_data.linhas[0].quantidade == 1
    assert any("não tem hora" in aviso for aviso in so_data.avisos)
    assert any("quantidade" in aviso for aviso in so_data.avisos)
    assert (ler_dinheiro("1.234,56"), ler_dinheiro("1,234.56"), ler_dinheiro("x")) == (
        123_456,
        123_456,
        None,
    )


def test_planilha_sem_as_colunas_explica_o_que_falta():
    with pytest.raises(ErroPlanilha, match="coluna de data e de produto"):
        ler_planilha("A;B\n1;2\n")
    with pytest.raises(ErroPlanilha, match="vazia"):
        ler_planilha("\n\n")


def test_sugere_o_item_do_cardapio_pelo_nome():
    itens = [(1, "Lasanha à bolonhesa"), (2, "Refrigerante lata"), (3, "Espaguete ao sugo")]
    assert sugerir_item("LASANHA A BOLONHESA", itens) == 1
    assert sugerir_item("Refrigerante Lata 350ml", itens) == 2
    assert sugerir_item("Couvert artístico", itens) is None


def planilha_de(noite: date, linhas: list[tuple[str, int, str]]) -> str:
    texto = "Data;Hora;Produto;Qtde;Total\n"
    for nome, quantidade, total in linhas:
        texto += f"{noite.strftime('%d/%m/%Y')};21:00;{nome};{quantidade};{total}\n"
    return texto


def test_importa_e_confere_com_os_pedidos_do_giro(app, como, cardapio):  # noqa: F811
    gerente = como("gerente@cantina.demo")
    hoje = noite_de(agora())
    # O GIRO viu 2 lasanhas; o caixa vendeu 3 lasanhas, 2 refrigerantes e um couvert.
    assert lancar(gerente, id_da_mesa(gerente, 1), (cardapio["lasanha"], 2)).status_code == 201
    arquivo = planilha_de(
        hoje,
        [("LASANHA A BOLONHESA", 3, "186,00"), ("Refri lata", 2, "14,00"), ("Couvert", 1, "15,00")],
    )
    previa = gerente.post("/api/caixa/previa", json={"arquivo": arquivo})
    assert previa.status_code == 200, previa.text
    previa = previa.json()
    assert (previa["noites"], previa["linhas"], previa["total_centavos"]) == (1, 3, 21_500)
    sugestoes = {n["nome"]: n["sugestao_item_id"] for n in previa["nomes"]}
    assert sugestoes == {
        "LASANHA A BOLONHESA": cardapio["lasanha"]["id"],
        "Refri lata": None,
        "Couvert": None,
    }
    with app.state.sessoes() as db:  # a prévia não grava nada
        assert db.scalars(select(VendaCaixa)).all() == []

    # O gerente associa o "Refri lata" ao refrigerante; o couvert fica sem item.
    resposta = gerente.post(
        "/api/caixa/importar",
        json={
            "arquivo": arquivo,
            "associacoes": [{"nome": "Refri lata", "item_id": cardapio["refri"]["id"]}],
        },
    )
    assert resposta.status_code == 201, resposta.text
    conferencia = gerente.get("/api/caixa/conferencia").json()
    assert conferencia["noites"] == [
        {"noite": hoje.isoformat(), "caixa_centavos": 21_500, "giro_centavos": 12_400}
    ]
    itens = {i["nome"]: i for i in conferencia["itens"]}
    assert (
        itens["Lasanha à bolonhesa"]["caixa_quantidade"],
        itens["Lasanha à bolonhesa"]["giro_quantidade"],
    ) == (3, 2)
    assert itens["Refrigerante lata"]["giro_quantidade"] == 0
    assert conferencia["sem_associacao"] == ["Couvert"]

    # Importar a mesma noite de novo troca as linhas (não soma em dobro).
    gerente.post(
        "/api/caixa/importar", json={"arquivo": planilha_de(hoje, [("Lasanha", 2, "124,00")])}
    )
    conferencia = gerente.get("/api/caixa/conferencia").json()
    assert conferencia["caixa_centavos"] == 12_400
    # O relatório do mês mostra o caixa ao lado do que foi lançado.
    relatorio = gerente.get("/api/relatorios/mes").json()
    assert relatorio["caixa"] == {"noites": 1, "caixa_centavos": 12_400, "giro_centavos": 12_400}
    # E fica no histórico do dono, sem o conteúdo da planilha.
    historico = como("dono@cantina.demo").get("/api/atividades?grupo=caixa").json()["atividades"]
    assert historico[0]["texto"].startswith("Importou a planilha do caixa de")
    assert historico[0]["quem"] == "Gerente"


def test_caixa_e_da_gestao_de_cada_restaurante(como, cardapio):  # noqa: F811
    arquivo = planilha_de(noite_de(agora()), [("Lasanha", 1, "62,00")])
    assert (
        como("equipe@cantina.demo").post("/api/caixa/previa", json={"arquivo": arquivo}).status_code
        == 403
    )
    vizinha = como("dono@vizinha.demo")
    # Item do cardápio de outro restaurante não serve.
    resposta = vizinha.post(
        "/api/caixa/importar",
        json={
            "arquivo": arquivo,
            "associacoes": [{"nome": "Lasanha", "item_id": cardapio["lasanha"]["id"]}],
        },
    )
    assert resposta.status_code == 404
    vizinha.post("/api/caixa/importar", json={"arquivo": arquivo})
    assert como("gerente@cantina.demo").get("/api/caixa/conferencia").json()["noites"] == []
    assert como("gerente@cantina.demo").get("/api/relatorios/mes").json()["caixa"] is None
    ontem = (noite_de(agora()) - timedelta(days=40)).strftime("%Y-%m")
    assert vizinha.get(f"/api/caixa/conferencia?mes={ontem}").json()["noites"] == []
    ruim = vizinha.post("/api/caixa/previa", json={"arquivo": "A;B\n1;2\n"})
    assert ruim.status_code == 422 and "coluna" in ruim.json()["detail"]
