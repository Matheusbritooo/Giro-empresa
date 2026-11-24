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


def test_pedido_lancado_conta_como_atendimento(maquina):
    alimentar(maquina, 0, 1, sentados=2)
    assert tipos(maquina.registrar_pedido(em(2))) == [TipoEvento.ATENDIDA]
    assert maquina.estado == Estado.OCUPADA
    assert maquina.estado_desde == em(2)
    # Atendida não alerta mais. Um segundo pedido não atende de novo: conta só como uma
    # passada da equipe pela mesa (é o que zera o relógio da mesa sem visita).
    assert tipos(alimentar(maquina, 1, 8, sentados=2)) == []
    assert tipos(maquina.registrar_pedido(em(9))) == [TipoEvento.VISITA]
    assert (maquina.estado, maquina.estado_desde, maquina.visitas) == (Estado.OCUPADA, em(2), 2)


def test_pedido_em_mesa_livre_abre_a_visita_ja_atendida(maquina):
    eventos = maquina.registrar_pedido(em(0))
    assert tipos(eventos) == [TipoEvento.SENTOU, TipoEvento.ATENDIDA]
    assert maquina.estado == Estado.OCUPADA
    # Depois a câmera vê quem está na mesa e, quando esvaziar, ela vai para limpar.
    alimentar(maquina, 0.1, 20, sentados=3)
    assert tipos(alimentar(maquina, 20, 22, sentados=0)) == [
        TipoEvento.SAIU,
        TipoEvento.ALERTA_MESA_VAGA,
    ]
    assert maquina.pessoas_max == 3


def test_pedido_usa_a_hora_em_que_a_camera_comecou_a_ver_gente(maquina):
    alimentar(maquina, 0, 0.1, sentados=2)  # 10 s: ainda não confirmou a ocupação
    eventos = maquina.registrar_pedido(em(0.2))
    assert eventos[0].tipo == TipoEvento.SENTOU and eventos[0].em == em(0)


def test_pedido_em_mesa_suja_fecha_a_visita_anterior(maquina):
    alimentar(maquina, 0, 1, sentados=2)
    maquina.registrar_pedido(em(1))
    alimentar(maquina, 1.1, 30, sentados=2)
    alimentar(maquina, 30, 32, sentados=0)
    assert maquina.estado == Estado.PARA_LIMPAR
    eventos = maquina.registrar_pedido(em(40))
    assert tipos(eventos) == [TipoEvento.LIBERADA, TipoEvento.SENTOU, TipoEvento.ATENDIDA]


# Mesa esquecida depois do atendimento: passadas da equipe e alerta de mesa sem visita.


def atendida(maquina: MaquinaMesa) -> None:
    """Casal senta às 0:00 e o garçom chega às 2:00 (fica 30s na mesa)."""
    alimentar(maquina, 0, 2, 2)
    alimentar(maquina, 2, 2.5, 2, em_pe=1)
    assert maquina.estado == Estado.OCUPADA and maquina.visitas == 1


def test_fotos_seguidas_com_o_garcom_sao_uma_passada_so(maquina):
    atendida(maquina)
    # Volta aos 10:00 e fica 40s: quatro fotos, uma passada.
    eventos = alimentar(maquina, 2.5, 10, 2) + alimentar(maquina, 10, 10 + 40 / 60, 2, em_pe=1)
    assert tipos(eventos) == [TipoEvento.VISITA]
    assert (maquina.visitas, maquina.ultima_visita) == (2, em(10) + timedelta(seconds=30))
    # Sai e volta logo (menos de 1 min depois): ainda a mesma passada.
    eventos = alimentar(maquina, 10 + 40 / 60, 11, 2) + alimentar(maquina, 11, 11.2, 2, em_pe=1)
    assert tipos(eventos) == [] and maquina.visitas == 2


def test_mesa_sem_visita_avisa_aos_15_minutos_e_some_na_passada(maquina):
    atendida(maquina)
    # A última foto com o garçom foi às 2:20: o alerta sai 15 min depois, uma vez só.
    eventos = alimentar(maquina, 2.5, 25, 2)
    assert tipos(eventos) == [TipoEvento.ALERTA_SEM_VISITA]
    assert eventos[0].em == em(17) + timedelta(seconds=20)
    # O garçom aparece: a passada sai como evento e desfaz o alerta.
    eventos = alimentar(maquina, 25, 25.5, 2, em_pe=1)
    assert tipos(eventos) == [TipoEvento.VISITA]
    assert not maquina.alertou_sem_visita
    # Mais 15 min sem ninguém: avisa de novo.
    assert tipos(alimentar(maquina, 25.5, 41, 2)) == [TipoEvento.ALERTA_SEM_VISITA]


def test_pedido_lancado_conta_como_passada(maquina):
    atendida(maquina)
    alimentar(maquina, 2.5, 12, 2)
    assert tipos(maquina.registrar_pedido(em(12))) == [TipoEvento.VISITA]
    assert maquina.visitas == 2
    # 15 min contados a partir do pedido.
    assert tipos(alimentar(maquina, 12, 26.9, 2)) == []
    assert tipos(alimentar(maquina, 26.9, 27.2, 2)) == [TipoEvento.ALERTA_SEM_VISITA]


def test_sem_camera_olhando_nao_avisa_mesa_sem_visita(maquina):
    # Mesa aberta só pelo pedido, sem nenhuma foto: não há como saber se alguém passou.
    maquina.registrar_pedido(em(0))
    assert maquina.verificar_tempo(em(40)) == []
    # Com câmera, mas a câmera parou de mandar foto: também não avisa.
    maquina2 = MaquinaMesa(regras=Regras())
    atendida(maquina2)
    assert maquina2.verificar_tempo(em(30)) == []


def test_mesa_esvaziando_ou_aviso_desligado_nao_avisa():
    # Clientes saindo: a câmera vê a mesa vazia, não é mesa esquecida.
    maquina = MaquinaMesa(regras=Regras())
    atendida(maquina)
    alimentar(maquina, 2.5, 16.9, 2)
    assert tipos(alimentar(maquina, 16.9, 17.6, 0)) == []
    # O dono desligou o aviso (zero em Ajustes).
    desligado = MaquinaMesa(regras=Regras(alerta_sem_visita=None))
    atendida(desligado)
    assert tipos(alimentar(desligado, 2.5, 40, 2)) == []


def test_passadas_sobrevivem_ida_e_volta_pelo_banco_e_zeram_na_saida(maquina):
    atendida(maquina)
    alimentar(maquina, 2.5, 18, 2)
    assert maquina.alertou_sem_visita
    copia = MaquinaMesa.de_dict(Regras(), maquina.para_dict())
    assert (copia.visitas, copia.ultima_visita, copia.alertou_sem_visita) == (
        1,
        maquina.ultima_visita,
        True,
    )
    alimentar(maquina, 18, 20, 0)  # foram embora
    assert maquina.estado == Estado.PARA_LIMPAR
    assert (maquina.visitas, maquina.ultima_visita, maquina.alertou_sem_visita) == (0, None, False)
