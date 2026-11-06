"""Perdas, curva ABC e preço que subiu, com contas à mão."""

from datetime import datetime, timedelta

from giro.dominio.perdas import (
    Movimentos,
    Subida,
    curva_abc,
    impacto_no_prato,
    perda_do_insumo,
    preco_da_nota,
    subida_de_preco,
    subida_recente,
)


def test_o_que_saiu_pela_ficha_e_o_que_escapou():
    # Na semana: vendas tiraram 30 kg de muçarela, um prato cancelado devolveu 100 g,
    # a equipe registrou 300 g de perda e a contagem de segunda achou 2,4 kg a menos.
    perda = perda_do_insumo(Movimentos(venda=-30_000, estorno=100, perda=-300, contagem=-2400))
    assert (perda.pela_ficha, perda.registrada, perda.sem_registro) == (29_900, 300, 2400)
    assert (perda.escapou, perda.saiu) == (2700, 32_600)
    # A contagem achou a mais: a diferença é negativa (sobrou).
    assert perda_do_insumo(Movimentos(venda=-1000, contagem=200)).escapou == -200


def test_curva_abc():
    # Gasto da semana, em ordem: muçarela 900, filé 800, chopp 400, carne 300, tomate 300,
    # sal 200. Total 2900. Antes da carne já iam 2100 (72%): ela cruza os 80% e entra no A.
    # O tomate começa em 83% (B), o sal em 93% (B); o que não gastou nada é C.
    gasto = {1: 900, 2: 800, 3: 300, 4: 400, 5: 300, 6: 200, 7: 0}
    assert curva_abc(gasto) == {1: "A", 2: "A", 4: "A", 3: "A", 5: "B", 6: "B", 7: "C"}
    # 700 (começa em 0%: A), 200 (70%: A), 60 (90%: B), 40 (96%: C).
    assert curva_abc({1: 700, 2: 200, 3: 60, 4: 40}) == {1: "A", 2: "A", 3: "B", 4: "C"}
    assert curva_abc({}) == {}
    assert curva_abc({1: 0}) == {1: "C"}


def test_preco_que_subiu_e_quanto_pesa_no_prato():
    assert preco_da_nota(10_000, 48_300, "g") == 4830  # 10 kg por R$ 483: R$ 48,30/kg
    assert preco_da_nota(12, 3360, "un") == 280
    subida = subida_de_preco(4200, 4830)
    assert subida == Subida(4200, 4830) and subida.pct == 15
    # 100 g de muçarela na lasanha: R$ 6,30/kg a mais = R$ 0,63 por prato.
    assert impacto_no_prato(subida, 100, "g") == 63
    assert subida_de_preco(4200, 4600) is None  # +9,5%: não avisa
    assert subida_de_preco(4200, 4620) is not None  # +10%: avisa
    assert subida_de_preco(None, 4830) is None  # primeira compra: nada a comparar


def test_a_compra_que_subiu_o_preco_nas_ultimas_semanas():
    dia = datetime(2026, 11, 3, 10)
    notas = [
        (dia - timedelta(days=14), 4150),
        (dia - timedelta(days=7), 4200),
        (dia, 4830),  # subiu 15%
        (dia + timedelta(days=2), 4850),  # compra de última hora, ainda cara
    ]
    subida, quando = subida_recente(notas, desde=dia - timedelta(days=28))
    assert (subida.antes_centavos, subida.agora_centavos, quando) == (4200, 4850, dia)
    # Voltou ao normal depois: não avisa mais.
    assert (
        subida_recente([*notas, (dia + timedelta(days=4), 4300)], dia - timedelta(days=28)) is None
    )
    # A subida foi antes da janela: fica de fora.
    assert subida_recente(notas, desde=dia + timedelta(days=1)) is None
    assert subida_recente(notas[:1], desde=dia) is None
