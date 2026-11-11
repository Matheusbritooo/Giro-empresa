"""Perdas, curva ABC e preço que subiu, com contas à mão."""

from datetime import UTC, datetime, timedelta

from giro.dominio.perdas import (
    Movimentos,
    Subida,
    curva_abc,
    impacto_no_prato,
    perda_do_insumo,
    preco_da_nota,
    sem_registro_no_periodo,
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


def test_a_contagem_vale_para_o_tempo_que_ela_cobre():
    agora = datetime(2026, 11, 6, 23, tzinfo=UTC)  # sexta à noite
    contou = datetime(2026, 11, 6, 15, tzinfo=UTC)
    dias = lambda n: timedelta(days=n)  # noqa: E731

    def no_periodo(contagens, entrou, tamanho, hoje=agora):
        return sem_registro_no_periodo(contagens, entrou, hoje - dias(tamanho), hoje, tamanho)

    # O estoque entrou há 28 dias e só hoje alguém contou: falta 1 kg. Os 7 dias levam um
    # quarto (250 g), não o quilo inteiro; as 4 semanas levam tudo.
    primeira = [(contou, -1000)]
    assert no_periodo(primeira, contou - dias(28), 7) == -250
    assert no_periodo(primeira, contou - dias(28), 28) == -1000

    # Contagem toda semana: os 7 dias mostram a semana que a última contagem fechou, e o
    # número não muda nos dias seguintes, enquanto ninguém conta de novo.
    toda_semana = [
        (contou - dias(21), -400),
        (contou - dias(14), -300),
        (contou - dias(7), -200),
        (contou, -100),
    ]
    assert no_periodo(toda_semana, contou - dias(28), 7) == -100
    assert no_periodo(toda_semana, contou - dias(28), 7, agora + dias(3)) == -100
    assert no_periodo(toda_semana, contou - dias(28), 28) == -1000
    # A contagem saiu do período: sem contagem, não há o que dizer.
    assert no_periodo(toda_semana, contou - dias(28), 7, agora + dias(8)) == 0

    # Começou contando tarde e depois pegou o ritmo: nas 4 semanas até a última contagem
    # cabem 7 dos 28 dias da primeira (700 g) e as três semanais (210 g). Antes eram 3,01 kg.
    pegou_o_ritmo = [
        (contou - dias(21), -2800),
        (contou - dias(14), -70),
        (contou - dias(7), -70),
        (contou, -70),
    ]
    assert no_periodo(pegou_o_ritmo, contou - dias(49), 28) == -910

    # A contagem achou a mais (compra que ninguém lançou): reparte do mesmo jeito.
    assert no_periodo([(contou, 600)], contou - dias(14), 7) == 300
    # Entrou no estoque e foi contado na mesma hora: não há tempo para repartir.
    assert no_periodo([(contou, -500)], contou, 7) == -500
    # Contagem depois do fim do período não entra na conta.
    assert no_periodo([(contou, -100), (agora + dias(1), -999)], contou - dias(7), 7) == -100


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
