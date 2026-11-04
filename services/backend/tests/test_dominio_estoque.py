"""Custo pela ficha, custo médio das compras, baixa e contagem, com contas à mão."""

from giro.dominio.estoque import (
    LinhaFicha,
    Unidade,
    baixa,
    custo_da_ficha,
    custo_de,
    custo_medio,
    diferencas_da_contagem,
)

G, ML, UN = Unidade.GRAMA, Unidade.MILILITRO, Unidade.UNIDADE

# Lasanha: 120 g de massa a R$ 18/kg (2,16), 120 g de carne a R$ 38/kg (4,56),
# 150 g de molho a R$ 9/kg (1,35), 100 g de muçarela a R$ 42/kg (4,20),
# 15 g de parmesão a R$ 85/kg (1,275) e R$ 3,50 de outros: R$ 17,045.
LASANHA = [
    LinhaFicha(120, G, 1800),
    LinhaFicha(120, G, 3800),
    LinhaFicha(150, G, 900),
    LinhaFicha(100, G, 4200),
    LinhaFicha(15, G, 8500),
]


def test_custo_de_cada_unidade():
    assert custo_de(300, ML, 1333) == 399.9  # 300 ml de chopp a R$ 13,33 o litro
    assert custo_de(2, UN, 260) == 520  # 2 latas a R$ 2,60
    assert custo_de(1500, G, 600) == 900  # 1,5 kg de batata a R$ 6/kg


def test_custo_do_prato_pela_ficha():
    assert custo_da_ficha(LASANHA, 350) == 1704  # 1704,5 arredonda para o par
    assert custo_da_ficha([LinhaFicha(1, UN, 260)], None) == 260  # refrigerante
    # Sem ficha ou com ingrediente sem preço: fica o custo digitado no cardápio.
    assert custo_da_ficha([], 350) is None
    assert custo_da_ficha([LinhaFicha(120, G, None), LinhaFicha(100, G, 4200)], 0) is None


def test_custo_medio_ponderado_depois_da_compra():
    # Tinha 2 kg a R$ 40/kg (R$ 80) e chegaram 10 kg por R$ 430: 12 kg por R$ 510 = R$ 42,50/kg.
    assert custo_medio(2000, 4000, 10_000, 43_000, G) == 4250
    # Primeira compra, ou estoque zerado: vale o preço da nota.
    assert custo_medio(0, None, 12, 3120, UN) == 260
    assert custo_medio(5000, None, 30_000, 40_000, ML) == 1333
    # A conta passou do real (saldo negativo): conta como zero, vale o preço da nota.
    assert custo_medio(-500, 4000, 1000, 4500, G) == 4500
    # Sem valor na nota (produção da casa), o preço não muda.
    assert custo_medio(2000, 4000, 1000, None, G) == 4000


def test_baixa_pela_ficha():
    ficha = {1: 120, 2: 120, 3: 0}
    assert baixa(ficha, 3) == {1: 360, 2: 360}


def test_diferencas_so_do_que_foi_contado():
    saldos = {1: 3200, 2: 30_000, 3: 500}
    contagem = diferencas_da_contagem(saldos, {2: 28_500, 1: 3200})
    assert [(d.insumo_id, d.antes, d.contado, d.diferenca) for d in contagem] == [
        (1, 3200, 3200, 0),
        (2, 30_000, 28_500, -1500),
    ]
