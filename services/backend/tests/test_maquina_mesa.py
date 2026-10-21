from datetime import UTC, datetime, timedelta

import pytest

from giro.dominio.mesa import (
    Estado,
    MaquinaMesa,
    Observacao,
    Regras,
    TipoEvento,
    TransicaoInvalida,
)

T0 = datetime(2026, 10, 23, 20, 0, tzinfo=UTC)


def em(minutos: float) -> datetime:
    return T0 + timedelta(minutes=minutos)


def alimentar(maquina: MaquinaMesa, de: float, ate: float, sentados: int, em_pe: int = 0):
    """Manda uma observação a cada 10s no intervalo [de, ate) em minutos."""
    eventos = []
    t = em(de)
    while t < em(ate):
        eventos += maquina.observar(Observacao(t, sentados, em_pe))
        t += timedelta(seconds=10)
    return eventos


def tipos(eventos):
    return [e.tipo for e in eventos]


@pytest.fixture
def maquina():
    return MaquinaMesa(regras=Regras())


def test_confirma_ocupacao_so_depois_de_20s_e_registra_a_hora_que_sentou(maquina):
    s = timedelta(seconds=1)
    assert maquina.observar(Observacao(T0, 2)) == []
    assert maquina.observar(Observacao(T0 + 10 * s, 2)) == []
    eventos = maquina.observar(Observacao(T0 + 20 * s, 2))
    assert tipos(eventos) == [TipoEvento.SENTOU]
    assert eventos[0].em == em(0)
    assert eventos[0].pessoas == 2
    assert maquina.estado == Estado.AGUARDANDO


def test_quem_so_passa_pela_mesa_nao_ocupa(maquina):
    assert alimentar(maquina, 0, 0.2, sentados=1) == []
    assert alimentar(maquina, 0.2, 1, sentados=0) == []
    assert maquina.estado == Estado.LIVRE


def test_alerta_sem_atendimento_aos_5_minutos_e_uma_vez_so(maquina):
    eventos = alimentar(maquina, 0, 8, sentados=3)
    alertas = [e for e in eventos if e.tipo == TipoEvento.ALERTA_SEM_ATENDIMENTO]
    assert len(alertas) == 1
    assert alertas[0].em == em(5)


def test_garcom_chegando_marca_atendimento(maquina):
    alimentar(maquina, 0, 2, sentados=2)
    eventos = alimentar(maquina, 2, 2.2, sentados=2, em_pe=1)
    assert tipos(eventos) == [TipoEvento.ATENDIDA]
    assert eventos[0].em == em(2)
    assert maquina.estado == Estado.OCUPADA
    assert alimentar(maquina, 2.2, 10, sentados=2) == []  # atendida: sem alerta depois


def test_saida_vira_para_limpar_com_alerta(maquina):
    alimentar(maquina, 0, 1, sentados=4)
    alimentar(maquina, 1, 1.1, sentados=4, em_pe=1)
    alimentar(maquina, 1.1, 60, sentados=4)
    eventos = alimentar(maquina, 60, 62, sentados=0)
    assert tipos(eventos) == [TipoEvento.SAIU, TipoEvento.ALERTA_MESA_VAGA]
    assert eventos[0].em == em(60)
    assert eventos[0].pessoas == 4
    assert eventos[1].em == em(61)
    assert maquina.estado == Estado.PARA_LIMPAR
    assert maquina.estado_desde == em(60)


def test_mesa_vazia_por_poucos_segundos_nao_conta_como_saida(maquina):
    alimentar(maquina, 0, 1, sentados=2)
    alimentar(maquina, 1, 1.1, sentados=2, em_pe=1)
    assert alimentar(maquina, 1.1, 1.6, sentados=0) == []  # 30s tampada
    alimentar(maquina, 1.6, 5, sentados=2)
    assert maquina.estado == Estado.OCUPADA


def test_cliente_que_desiste_libera_a_mesa_sem_alerta_de_limpeza(maquina):
    alimentar(maquina, 0, 4, sentados=2)
    eventos = alimentar(maquina, 4, 6, sentados=0)
    assert tipos(eventos) == [TipoEvento.SAIU_SEM_ATENDIMENTO]
    assert eventos[0].em == em(4)
    assert maquina.estado == Estado.LIVRE


def test_equipe_libera_mesa(maquina):
    alimentar(maquina, 0, 1, sentados=2)
    alimentar(maquina, 1, 1.1, sentados=2, em_pe=1)
    alimentar(maquina, 1.1, 30, sentados=2)
    alimentar(maquina, 30, 32, sentados=0)
    eventos = maquina.liberar(em(45))
    assert tipos(eventos) == [TipoEvento.LIBERADA]
    assert maquina.estado == Estado.LIVRE
    assert maquina.estado_desde == em(45)


def test_liberar_mesa_que_nao_esta_suja_e_erro(maquina):
    with pytest.raises(TransicaoInvalida):
        maquina.liberar(em(0))


def test_nova_turma_sentando_em_mesa_suja_fecha_a_anterior(maquina):
    alimentar(maquina, 0, 1, sentados=2)
    alimentar(maquina, 1, 1.1, sentados=2, em_pe=1)
    alimentar(maquina, 1.1, 30, sentados=2)
    alimentar(maquina, 30, 32, sentados=0)
    eventos = alimentar(maquina, 40, 41, sentados=3)
    assert tipos(eventos) == [TipoEvento.LIBERADA, TipoEvento.SENTOU]
    assert all(e.em == em(40) for e in eventos)
    assert maquina.estado == Estado.AGUARDANDO


def test_observacao_fora_de_ordem_e_ignorada(maquina):
    alimentar(maquina, 0, 1, sentados=2)
    assert maquina.observar(Observacao(em(0.5), 0, 0)) == []
    assert maquina.estado == Estado.AGUARDANDO


def test_verificar_tempo_alerta_mesmo_sem_observacao_nova(maquina):
    alimentar(maquina, 0, 1, sentados=2)
    assert maquina.verificar_tempo(em(4.9)) == []
    assert tipos(maquina.verificar_tempo(em(5.2))) == [TipoEvento.ALERTA_SEM_ATENDIMENTO]
    assert maquina.verificar_tempo(em(6)) == []


def test_regras_do_restaurante_mudam_o_tempo_do_alerta():
    maquina = MaquinaMesa(regras=Regras(alerta_sem_atendimento=timedelta(minutes=3)))
    eventos = alimentar(maquina, 0, 4, sentados=2)
    assert [e.em for e in eventos if e.tipo == TipoEvento.ALERTA_SEM_ATENDIMENTO] == [em(3)]


def test_estado_sobrevive_ida_e_volta_pelo_banco(maquina):
    alimentar(maquina, 0, 2, sentados=2)
    copia = MaquinaMesa.de_dict(Regras(), maquina.para_dict())
    assert copia == maquina
    # e continua de onde parou
    assert tipos(alimentar(copia, 2, 6, sentados=2)) == [TipoEvento.ALERTA_SEM_ATENDIMENTO]
