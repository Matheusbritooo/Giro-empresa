"""Relatório do mês: noite a noite, mais vendidos, comparação com o mês anterior e a parte de
custo só para o dono. Mês do calendário, isolado por restaurante."""

from datetime import date, timedelta

from giro.banco import agora
from giro.dominio.indicadores import noite_de
from giro.servicos.relatorio import (
    intervalo_do_mes,
    janela_de_comparacao,
    mes_anterior,
    ultimo_dia,
)
from tests.test_cardapio import cardapio, id_da_mesa, lancar  # noqa: F401 (fixture)
from tests.test_estoque import estoque  # noqa: F401 (fixture)


def test_mes_do_calendario_noite_a_noite():
    assert ultimo_dia(date(2026, 2, 10)) == date(2026, 2, 28)
    assert ultimo_dia(date(2028, 2, 1)) == date(2028, 2, 29)
    assert mes_anterior(date(2026, 1, 15)) == date(2025, 12, 1)
    inicio, fim = intervalo_do_mes(date(2026, 10, 1))
    # Da noite de 1º de outubro (6h) até o fim da noite de 31 (6h de 1º de novembro).
    assert noite_de(inicio) == date(2026, 10, 1)
    assert noite_de(fim - timedelta(seconds=1)) == date(2026, 10, 31)


def test_compara_com_o_mesmo_trecho_do_mes_anterior_e_so_com_o_giro_em_uso():
    novembro = date(2026, 11, 1)
    inicio, _ = intervalo_do_mes(novembro)
    outubro, fim_outubro = intervalo_do_mes(date(2026, 10, 1))
    desde_setembro = outubro - timedelta(days=30)
    # Mês em andamento (24/11 às 20h): de 1/10 às 6h até 24/10 às 20h.
    agora_ = inicio + timedelta(days=23, hours=14)
    de, ate = janela_de_comparacao(novembro, agora_, desde_setembro)
    assert (de, ate) == (outubro, outubro + timedelta(days=23, hours=14))
    # Mês fechado: o mês anterior inteiro.
    assert janela_de_comparacao(novembro, agora_ + timedelta(days=30), desde_setembro) == (
        outubro,
        fim_outubro,
    )
    # 31 de março contra fevereiro: não passa do fim de fevereiro.
    marco, _ = intervalo_do_mes(date(2027, 3, 1))
    _, ate = janela_de_comparacao(
        date(2027, 3, 1), marco + timedelta(days=30, hours=15), marco - timedelta(days=90)
    )
    assert ate == intervalo_do_mes(date(2027, 2, 1))[1]
    # O GIRO entrou no meio de outubro (ou nunca viu ninguém): sem comparação.
    assert janela_de_comparacao(novembro, agora_, outubro + timedelta(days=26)) is None
    assert janela_de_comparacao(novembro, agora_, None) is None


def test_relatorio_do_mes_com_custo_so_para_o_dono(como, cardapio, estoque):  # noqa: F811
    equipe = como("equipe@cantina.demo")
    assert lancar(equipe, id_da_mesa(equipe, 1), (cardapio["lasanha"], 2)).status_code == 201
    assert lancar(equipe, id_da_mesa(equipe, 2), (cardapio["refri"], 3)).status_code == 201

    dono = como("dono@cantina.demo").get("/api/relatorios/mes").json()
    hoje = noite_de(agora())
    assert dono["mes"] == hoje.replace(day=1).isoformat()
    assert (dono["restaurante"], dono["completo"]) == ("Cantina do Marcos", False)
    assert dono["ultima_noite"] == hoje.isoformat()
    # As visitas começaram agora: não há mês anterior para comparar.
    assert (dono["comparado_de"], dono["comparado_ate"]) == (None, None)
    assert len(dono["noites"]) == hoje.day
    # 2 lasanhas a R$ 62 e 3 latas a R$ 7.
    assert dono["vendeu_centavos"] == 12_400 + 2_100
    assert dono["noites"][-1]["vendeu_centavos"] == 14_500
    assert [(p["nome"], p["quantidade"]) for p in dono["pratos"]] == [
        ("Refrigerante lata", 3),
        ("Lasanha à bolonhesa", 2),
    ]
    assert sum(s["vendeu_centavos"] for s in dono["semanas"]) == 14_500
    # Custo pela ficha: 2 × R$ 14,42 da lasanha + 3 × R$ 2,60 da lata.
    assert dono["custo"]["custo_pela_ficha_centavos"] == 2 * 1442 + 3 * 260
    assert dono["custo"]["escapou_centavos"] == 0

    gerente = como("gerente@cantina.demo").get("/api/relatorios/mes")
    assert gerente.status_code == 200
    assert gerente.json()["custo"] is None
    assert gerente.json()["vendeu_centavos"] == 14_500


def test_relatorio_e_da_gestao_de_cada_restaurante_e_do_passado(como, cardapio):  # noqa: F811
    assert como("equipe@cantina.demo").get("/api/relatorios/mes").status_code == 403
    vizinha = como("dono@vizinha.demo").get("/api/relatorios/mes").json()
    assert (vizinha["vendeu_centavos"], vizinha["pratos"]) == (0, [])
    dono = como("dono@cantina.demo")
    futuro = (noite_de(agora()).replace(day=1) + timedelta(days=40)).strftime("%Y-%m")
    assert dono.get(f"/api/relatorios/mes?mes={futuro}").status_code == 422
    assert dono.get("/api/relatorios/mes?mes=2026-13").status_code == 422
    passado = dono.get("/api/relatorios/mes?mes=2025-02").json()
    assert (passado["completo"], len(passado["noites"]), passado["mesas_atendidas"]) == (
        True,
        28,
        0,
    )
