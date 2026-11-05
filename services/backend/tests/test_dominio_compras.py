"""Previsão e lista de compras, com contas à mão."""

from datetime import date

from giro.dominio.compras import (
    Situacao,
    ler_dias_de_compra,
    linha_de_compra,
    mediana_redonda,
    noites_cobertas,
    noites_iguais,
    previsao,
    proxima_compra,
    quando_acaba,
    saidas_previstas,
    situacao,
)

TERCA, QUARTA, SEXTA, SABADO, DOMINGO = (
    date(2026, 11, 3),
    date(2026, 11, 4),
    date(2026, 11, 6),
    date(2026, 11, 7),
    date(2026, 11, 8),
)
COMPRAS = {1, 4}  # terça e sexta


def test_mediana_das_ultimas_4_noites_iguais():
    assert mediana_redonda([19, 24, 23, 20]) == 22  # 20 e 23 no meio: 21,5 vira 22
    assert mediana_redonda([22, 23, 24, 27]) == 24  # 23,5 vira 24
    assert mediana_redonda([14, 60, 15, 13]) == 15  # a sexta de feriado não puxa a conta
    assert mediana_redonda([]) == 0

    assert noites_iguais(SEXTA) == [
        date(2026, 10, 9),
        date(2026, 10, 16),
        date(2026, 10, 23),
        date(2026, 10, 30),
    ]
    # Para a sexta da semana que vem, olhada hoje (quarta), a sexta que vem ainda não
    # aconteceu: entram as 4 sextas que já passaram.
    assert noites_iguais(date(2026, 11, 13), hoje=QUARTA) == noites_iguais(SEXTA)
    assert noites_iguais(date(2026, 11, 11), hoje=QUARTA)[-1] == date(2026, 10, 28)
    vendas = {date(2026, 10, 9): 19, date(2026, 10, 16): 24, date(2026, 10, 30): 20}
    # A sexta 23/10 não teve lasanha: conta como zero.
    assert previsao(vendas, SEXTA) == (20, [19, 24, 0, 20])


def test_dia_da_compra_e_noites_que_ela_cobre():
    assert ler_dias_de_compra("1,4") == COMPRAS
    assert ler_dias_de_compra("bagunça") == COMPRAS  # volta para o padrão
    assert ler_dias_de_compra("4,9") == {4}

    assert proxima_compra(SEXTA, COMPRAS) == SEXTA  # hoje é dia de compra
    assert proxima_compra(QUARTA, COMPRAS) == SEXTA
    assert proxima_compra(DOMINGO, COMPRAS) == date(2026, 11, 10)  # a terça seguinte
    # Sexta cobre sexta a segunda (fechada, mas na conta); terça cobre terça a quinta.
    assert noites_cobertas(SEXTA, COMPRAS) == [SEXTA, SABADO, DOMINGO, date(2026, 11, 9)]
    assert noites_cobertas(TERCA, COMPRAS) == [TERCA, QUARTA, date(2026, 11, 5)]
    assert len(noites_cobertas(TERCA, {1})) == 7  # um dia de compra só: a semana inteira


def test_o_que_sai_de_cada_ingrediente():
    # Lasanha (prato 1) leva 120 g de massa (10) e 100 g de muçarela (20); parmegiana
    # (prato 2) leva 100 g de muçarela.
    fichas = {1: {10: 120, 20: 100}, 2: {20: 100}}
    pratos = {1: {SEXTA: 22, SABADO: 24}, 2: {SEXTA: 18}, 3: {SEXTA: 5}}  # 3: sem ficha
    assert saidas_previstas(pratos, fichas) == {
        10: {SEXTA: 2640, SABADO: 2880},
        20: {SEXTA: 2200 + 1800, SABADO: 2400},
    }


def test_quando_acaba():
    saidas = [(SEXTA, 2640), (SABADO, 2880), (DOMINGO, 2760)]
    assert quando_acaba(2000, saidas) == SEXTA
    assert quando_acaba(6000, saidas) == DOMINGO
    assert quando_acaba(9000, saidas) is None
    assert quando_acaba(0, [(SEXTA, 0), (SABADO, 0)]) is None  # zerado e ninguém usa


def test_lista_de_compras_da_massa_de_lasanha():
    # 69 lasanhas × 120 g = 8280 g; com 15%, 9522 g; tem 2000 g; faltam 7522 g: 8 pacotes.
    linha = linha_de_compra(tem=2000, sai_ate_compra=0, precisa=8280, folga_pct=15, embalagem=1000)
    assert (linha.com_folga, linha.falta, linha.embalagens, linha.quantidade) == (
        9522,
        7522,
        8,
        8000,
    )
    assert situacao(linha, SABADO, SEXTA) == Situacao.COMPRAR

    # Hoje é quarta: até sexta ainda saem 3 kg. Tem 5 kg: sobram 2 kg na compra.
    linha = linha_de_compra(5000, 3000, 8280, 15, 1000)
    assert (linha.sobra, linha.falta, linha.embalagens) == (2000, 7522, 8)
    # Se acaba antes da compra, a sobra é zero: a compra cobre só as noites dela.
    linha = linha_de_compra(1000, 3000, 8280, 15, 1000)
    assert (linha.sobra, linha.falta, linha.embalagens) == (0, 9522, 10)
    assert situacao(linha, QUARTA, SEXTA) == Situacao.VAI_FALTAR  # urgente


def test_situacao_de_cada_ingrediente():
    assert situacao(linha_de_compra(0, 0, 0, 15, 1000), None, SEXTA) == Situacao.ZERADO
    # Dá até a compra, mas sem a folga: entra na lista, sem alarme.
    assert situacao(linha_de_compra(9000, 0, 8280, 15, 1000), None, SEXTA) == Situacao.COMPRAR
    assert situacao(linha_de_compra(9600, 0, 8280, 15, 1000), None, SEXTA) == Situacao.TEM
    sem_uso = linha_de_compra(500, 0, 0, 15, 1000)  # ninguém usa: não entra na lista
    assert (situacao(sem_uso, None, SEXTA), sem_uso.embalagens) == (Situacao.TEM, 0)


def test_textos_para_o_fornecedor():
    from giro.dominio.compras import plural, texto_compra, texto_quantidade

    assert texto_quantidade("g", 3250) == "3,25 kg"
    assert texto_quantidade("g", 800) == "800 g"
    assert texto_quantidade("ml", 30_000) == "30 L"
    assert texto_quantidade("un", 1) == "1 unidade"
    assert plural("pacote de 1 kg") == "pacotes de 1 kg"
    assert plural("barril de 30 L") == "barris de 30 L"
    assert plural("garrafa") == "garrafas"
    assert texto_compra("g", 8, 1000, "pacote de 1 kg") == "8 pacotes de 1 kg"
    assert texto_compra("ml", 1, 30_000, "barril de 30 L") == "1 barril de 30 L"
    assert texto_compra("g", 7, 1000, "kg") == "7 kg"
    assert texto_compra("un", 2, 12, None) == "24 unidades"
