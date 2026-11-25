"""O Copiloto avisa sozinho: o que mudou da semana anterior para a que passou, uma vez por
semana no celular e sempre na tela Hoje."""

from dataclasses import replace
from datetime import date, datetime, timedelta

from giro.banco import agora
from giro.dominio.indicadores import Indicadores, NotasDosClientes, PorMesa, noite_de
from giro.dominio.semana import Mudanca, mudancas_da_semana
from giro.modelos import Restaurante
from giro.servicos import turno
from giro.servicos.semana import chave_da_semana
from giro.servicos.turno import momento_na_noite, verificar_avisos
from tests.test_copiloto import PushDeMentira, cantina_com_historico  # noqa: F401 (fixture)

INICIO = datetime(2026, 11, 1)

BASE = Indicadores(
    inicio=INICIO,
    fim=INICIO,
    noites=6,
    mesas_atendidas=160,
    pessoas_atendidas=420,
    desistencias=5,
    pessoas_desistiram=12,
    giro_medio=2.0,
    espera_media_seg=180,
    esperas_acima_do_limite=4,
    permanencia_media_seg=3600,
    parada_media_seg=240,
    parada_total_seg=38_400,
    hora_pico=20,
    ticket_medio_centavos=8500,
    perdido_desistencias_centavos=100_000,
    perdido_mesa_parada_centavos=50_000,
)


def mesa(numero, parada):
    return PorMesa(numero, 4, 20, 0, 180, parada, parada * 20, 0)


def notas(media, quantidade=30):
    return NotasDosClientes(quantidade, media, quantidade, media, 0, None)


def tipos(mudancas):
    return [(m.tipo, m.piorou) for m in mudancas]


def test_semana_igual_nao_vira_aviso():
    pouco = replace(BASE, espera_media_seg=200, desistencias=6, mesas_atendidas=150)
    assert mudancas_da_semana(pouco, BASE, notas(4.5), notas(4.4)) == []


def test_piora_vem_primeiro_e_uma_melhora_fecha_a_lista():
    atual = replace(
        BASE,
        espera_media_seg=300,  # +67% e +2 min
        parada_media_seg=420,  # +75%
        desistencias=12,
        perdido_desistencias_centavos=240_000,
        por_mesa=[mesa(7, 900), mesa(3, 200)],
    )
    mudancas = mudancas_da_semana(atual, BASE, notas(4.6), notas(4.1))
    assert tipos(mudancas) == [("desistencias", True), ("ficou_na_mesa", True), ("nota", False)]

    so_pioras = mudancas_da_semana(atual, BASE)
    assert len(so_pioras) == 3 and all(m.piorou for m in so_pioras)
    parada = mudancas_da_semana(
        replace(atual, desistencias=5, perdido_desistencias_centavos=100_000), BASE
    )
    textos = {m.tipo: m.texto for m in parada}
    assert textos["parada"] == (
        "A mesa ficou parada suja 7,0 min em média, contra 4,0 na semana anterior. "
        "A mesa 7 foi a que mais esperou limpeza."
    )
    assert textos["espera"].startswith("A espera até o garçom subiu de 3,0 para 5,0 min")


def test_melhora_e_movimento():
    # Várias melhoras: só a maior entra (quem foi embora caiu 80%).
    melhor = replace(BASE, espera_media_seg=100, mesas_atendidas=200, desistencias=1)
    textos = [m.texto for m in mudancas_da_semana(melhor, BASE)]
    assert textos == ["Só 1 mesa foi embora sem atendimento, contra 5 na semana anterior."]
    textos = [m.texto for m in mudancas_da_semana(replace(BASE, espera_media_seg=100), BASE)]
    assert textos == ["A espera até o garçom caiu de 3,0 para 1,7 min nesta semana."]
    pior = replace(BASE, mesas_atendidas=120)
    assert [m.texto for m in mudancas_da_semana(pior, BASE)] == [
        "O salão atendeu 25% menos mesas: 120 contra 160."
    ]


def test_semana_fraca_nao_compara():
    assert mudancas_da_semana(replace(BASE, mesas_atendidas=10), BASE) == []


def test_chave_da_semana_e_a_segunda():
    assert chave_da_semana(date(2026, 11, 24)) == "2026-11-23"  # terça
    assert chave_da_semana(date(2026, 11, 29)) == "2026-11-23"  # domingo
    assert chave_da_semana(date(2026, 11, 30)) == "2026-11-30"


def test_aviso_sai_uma_vez_por_semana_no_briefing(app, cantina_com_historico, monkeypatch):  # noqa: F811
    aviso = Mudanca("espera", True, "A espera até o garçom subiu de 3,0 para 5,0 min.", "/x")
    monkeypatch.setattr(turno, "semana_que_passou", lambda db, r, a: [aviso])
    push = PushDeMentira()
    noite = noite_de(agora())
    abre = momento_na_noite(noite, "18:00")
    with app.state.sessoes() as db:
        verificar_avisos(db, push, abre + timedelta(minutes=1))
        verificar_avisos(db, push, abre + timedelta(minutes=3))
        # O dia seguinte, na mesma semana (se ainda for a mesma): não repete.
        if chave_da_semana(noite + timedelta(days=1)) == chave_da_semana(noite):
            verificar_avisos(db, push, abre + timedelta(days=1, minutes=1))
    notou = [(r, c) for r, t, c in push.enviados if t == "O Copiloto notou"]
    assert len(notou) == 2  # um por restaurante
    assert notou[0][1] == aviso.texto
    with app.state.sessoes() as db:
        cantina = db.get(Restaurante, cantina_com_historico)
        assert cantina.ultimo_aviso_semana == chave_da_semana(noite)

    # Semana sem mudança que valha: nada sai, mas fica marcada (não tenta de novo).
    monkeypatch.setattr(turno, "semana_que_passou", lambda db, r, a: [])
    push.enviados.clear()
    proxima = noite + timedelta(days=7)
    with app.state.sessoes() as db:
        verificar_avisos(db, push, momento_na_noite(proxima, "18:00") + timedelta(minutes=1))
        cantina = db.get(Restaurante, cantina_com_historico)
        assert cantina.ultimo_aviso_semana == chave_da_semana(proxima)
    assert [t for _, t, _ in push.enviados if t == "O Copiloto notou"] == []


def test_hoje_mostra_o_que_o_copiloto_notou(como, cantina_com_historico):  # noqa: F811
    hoje = como("gerente@cantina.demo").get("/api/hoje").json()
    assert isinstance(hoje["semana"], list)
    for mudanca in hoje["semana"]:
        assert set(mudanca) == {"tipo", "piorou", "texto", "href"}
