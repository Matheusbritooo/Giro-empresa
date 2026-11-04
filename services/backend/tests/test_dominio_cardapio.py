"""Matriz de lucro, combinações, tempo de cozinha e previsão de vaga, com contas à mão."""

from giro.dominio.cardapio import (
    MINUTOS_ATE_VAGAR_PADRAO,
    Quadrante,
    Venda,
    combinacoes,
    matriz_de_lucro,
    minutos_ate_vagar,
    tempo_de_preparo,
)

# Massas de uma semana. Total vendido: 100. Corte de popularidade: 70% de 1/4 = 17,5%.
# Lucro por unidade: lasanha 45, espaguete 38, polpettone 46, fettuccine 30.
# Lucro médio ponderado: (40*45 + 40*38 + 10*46 + 10*30) / 100 = 40,8.
MASSAS = [
    Venda(1, "Lasanha", 40, 40 * 6200, 1700),
    Venda(2, "Espaguete", 40, 40 * 4800, 1000),
    Venda(3, "Polpettone", 10, 10 * 6600, 2000),
    Venda(4, "Fettuccine", 10, 10 * 4600, 1600),
    Venda(5, "Ravioli", 3, 3 * 5600, None),  # sem custo informado
]


def test_matriz_de_lucro_de_uma_categoria():
    matriz = matriz_de_lucro(MASSAS)
    assert matriz is not None
    assert matriz.lucro_medio_centavos == 4080
    quadrantes = {i.nome: i.quadrante for i in matriz.itens}
    assert quadrantes == {
        "Lasanha": Quadrante.ESTRELA,  # vende muito, lucra 45 > 40,8
        "Espaguete": Quadrante.BURRO_DE_CARGA,  # vende muito, lucra 38
        "Polpettone": Quadrante.QUEBRA_CABECA,  # vende pouco, lucra 46
        "Fettuccine": Quadrante.CAO,  # vende pouco, lucra 30
    }
    assert matriz.sem_custo == ["Ravioli"]
    assert [i.nome for i in matriz.itens][:2] == ["Espaguete", "Lasanha"]  # mais vendidos primeiro


def test_matriz_usa_o_preco_que_foi_pago():
    # Metade das lasanhas saiu a R$ 62 e metade a R$ 70 depois do aumento: média R$ 66.
    matriz = matriz_de_lucro([Venda(1, "Lasanha", 10, 5 * 6200 + 5 * 7000, 1700), MASSAS[1]])
    assert next(i for i in matriz.itens if i.nome == "Lasanha").lucro_unidade_centavos == 4900


def test_sem_dois_pratos_com_custo_nao_ha_matriz():
    assert matriz_de_lucro([MASSAS[0], MASSAS[4]]) is None
    assert matriz_de_lucro([]) is None


def test_o_que_combina_com_o_prato():
    # Visitas: itens pedidos. 10 = lasanha, 20 = refrigerante, 21 = vinho, 30 = tiramisù.
    visitas = [{10, 20}, {10, 21, 30}, {10, 20, 30}, {10, 21}, {11, 20}]
    resultado = combinacoes(visitas, 10, candidatos={20, 21, 30})
    assert resultado == [(20, 0.5), (21, 0.5), (30, 0.5)]
    assert combinacoes(visitas, 10, candidatos={30}) == [(30, 0.5)]
    assert combinacoes(visitas, 99, candidatos={20}) == []


def test_tempo_de_cozinha_separa_o_fim_de_semana():
    amostras = [(14, False), (16, False), (15, False), (24, True), (26, True), (22, True)]
    tempo = tempo_de_preparo(amostras)
    assert tempo.minutos == 19.0
    assert tempo.minutos_fim_de_semana == 24.0
    assert tempo.minutos_semana == 15.0
    assert tempo.amostras == 6
    # Poucas amostras: sem conta. E pedido esquecido aberto por horas não entra.
    assert tempo_de_preparo([(14, False), (16, False)]) is None
    assert tempo_de_preparo([(14, False), (16, False), (15, False), (600, True)]).minutos == 15.0


def test_quanto_tempo_a_mesa_leva_para_vagar_depois_da_conta():
    assert minutos_ate_vagar([8, 9, 10, 11, 12, 7, 13]) == 10
    assert minutos_ate_vagar([4, 5, 6, 5, 5]) == 5
    assert minutos_ate_vagar([5, 6]) == MINUTOS_ATE_VAGAR_PADRAO  # pouca amostra
    assert minutos_ate_vagar([5, 6, 7, 300, -2]) == MINUTOS_ATE_VAGAR_PADRAO
