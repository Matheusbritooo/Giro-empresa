"""Copiloto GIRO e avisos do turno: regras sem IA, IA de mentira, LGPD, perfis e push."""

import json
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from sqlalchemy import select

from giro.api.rotas import copiloto as rotas_copiloto
from giro.banco import agora
from giro.demo_historico import gerar_historico
from giro.dominio.indicadores import FUSO, MesaInfo, Visita, calcular, intervalo_da_noite, noite_de
from giro.modelos import Restaurante
from giro.servicos.turno import momento_na_noite, texto_do_resumo, verificar_avisos


@pytest.fixture
def cantina_com_historico(app):
    with app.state.sessoes() as db:
        cantina = db.scalar(select(Restaurante).where(Restaurante.nome == "Cantina do Marcos"))
        assert gerar_historico(db, cantina.id, noite_de(agora())) > 100
        db.commit()
        return cantina.id


class IADeMentira:
    """Faz o papel do cliente da Anthropic e guarda o que recebeu."""

    def __init__(self, resposta=None, erro=None):
        self.pedidos = []
        self.resposta, self.erro = resposta, erro
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._criar))

    def _criar(self, **pedido):
        self.pedidos.append(pedido)
        if self.erro:
            raise self.erro
        return self.resposta


def resposta_da_ia(texto, stop_reason="end_turn"):
    return SimpleNamespace(
        stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=texto)]
    )


def test_briefing_sem_ia(como, cantina_com_historico):
    r = como("dono@cantina.demo").get("/api/copiloto/briefing")
    assert r.status_code == 200, r.text
    dados = r.json()
    assert dados["ia_ligada"] is False
    assert dados["frases"][0].startswith(f"Hoje é {dados['dia_semana']}")
    assert dados["dicas"]


def test_pergunta_sem_ia_responde_com_regras(como, cantina_com_historico):
    r = como("gerente@cantina.demo").post(
        "/api/copiloto/perguntar", json={"pergunta": "Qual mesa mais me dá prejuízo?"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["fonte"] == "regras"
    assert "mesa" in r.json()["resposta"].lower()
    r = como("gerente@cantina.demo").post(
        "/api/copiloto/perguntar", json={"pergunta": "Quanto eu perdi?"}
    )
    assert "R$" in r.json()["resposta"]


def test_com_ia_so_numeros_saem_do_servidor(app, como, cantina_com_historico):
    ia = IADeMentira(resposta=resposta_da_ia("A mesa 3 é a que mais custa. Libere mais rápido."))
    app.state.copiloto._cliente = ia
    r = como("dono@cantina.demo").post(
        "/api/copiloto/perguntar", json={"pergunta": "Onde estou perdendo dinheiro?"}
    )
    assert r.json() == {
        "resposta": "A mesa 3 é a que mais custa. Libere mais rápido.",
        "fonte": "ia",
    }
    pedido = ia.pedidos[0]
    assert pedido["model"] == "claude-opus-5-5"
    assert pedido["fallbacks"] == "default"
    conteudo = pedido["messages"][0]["content"]
    numeros = json.loads(conteudo.split("\n", 1)[1].split("\n\nPergunta do dono:")[0])
    assert numeros["restaurante"] == "Cantina do Marcos"
    assert numeros["ultimas_4_semanas"]["turmas_atendidas"] > 0
    # Nada de pessoa: nem e-mail, nem nome de usuário, nem imagem.
    for proibido in ("@", "Dono", "Gerente", "Equipe", "base64", "imagem"):
        assert proibido not in conteudo.split("\n\nPergunta do dono:")[0]


@pytest.mark.parametrize(
    "ia",
    [
        IADeMentira(
            erro=anthropic.APIConnectionError(
                request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
            )
        ),
        IADeMentira(resposta=resposta_da_ia("", stop_reason="refusal")),
    ],
)
def test_ia_fora_do_ar_ou_recusando_cai_nas_regras(app, como, cantina_com_historico, ia):
    app.state.copiloto._cliente = ia
    r = como("dono@cantina.demo").post(
        "/api/copiloto/perguntar", json={"pergunta": "Que horas o salão lota?"}
    )
    assert r.status_code == 200
    assert r.json()["fonte"] == "regras"


def test_limite_de_perguntas_por_hora(como, cantina_com_historico, monkeypatch):
    monkeypatch.setattr(rotas_copiloto, "PERGUNTAS_POR_HORA", 2)
    dono = como("dono@cantina.demo")
    for _ in range(2):
        assert dono.post("/api/copiloto/perguntar", json={"pergunta": "pico?"}).status_code == 200
    assert dono.post("/api/copiloto/perguntar", json={"pergunta": "pico?"}).status_code == 429


def test_copiloto_respeita_perfis_e_restaurante(como, cantina_com_historico):
    assert como("equipe@cantina.demo").get("/api/copiloto/briefing").status_code == 403
    vizinho = como("dono@vizinha.demo")
    params = {"restaurante_id": cantina_com_historico}
    assert vizinho.get("/api/copiloto/briefing", params=params).status_code == 404
    r = vizinho.post("/api/copiloto/perguntar", params=params, json={"pergunta": "pico?"})
    assert r.status_code == 404


def test_horario_depois_da_meia_noite_e_da_mesma_noite():
    sexta = date(2026, 10, 16)
    assert momento_na_noite(sexta, "23:30") == datetime(2026, 10, 16, 23, 30, tzinfo=FUSO)
    assert momento_na_noite(sexta, "00:30") == datetime(2026, 10, 17, 0, 30, tzinfo=FUSO)


def test_texto_do_resumo_da_noite():
    inicio, fim = intervalo_da_noite(date(2026, 10, 16))
    h = lambda hora, minuto=0: datetime(2026, 10, 16, hora, minuto, tzinfo=FUSO)  # noqa: E731
    visitas = [
        Visita(7, h(20), h(20, 2), h(21), h(21, 15), pessoas=4),
        Visita(7, h(21, 30), None, h(21, 45), h(21, 45), pessoas=2, sem_atendimento=True),
    ]
    r = calcular(
        visitas,
        [MesaInfo(7, 6)],
        inicio,
        fim,
        ticket_medio_centavos=8500,
        limite_alerta=timedelta(minutes=5),
    )
    texto = texto_do_resumo(r)
    assert texto.startswith("1 mesa atendida, giro de 1,0 por mesa.")
    assert "1 mesa foi embora sem atendimento" in texto
    assert "Mesa 7: 15 min parada" in texto


class PushDeMentira:
    ativo = True

    def __init__(self):
        self.enviados = []

    def enviar(self, restaurante_id, titulo, corpo, papeis, url="/salao"):
        self.enviados.append((restaurante_id, titulo, corpo))


def test_briefing_na_abertura_e_resumo_no_fechamento_uma_vez_por_noite(app, cantina_com_historico):
    push = PushDeMentira()
    noite = noite_de(agora())
    abre = momento_na_noite(noite, "18:00")
    fecha = momento_na_noite(noite, "23:30")
    with app.state.sessoes() as db:
        verificar_avisos(db, push, abre - timedelta(minutes=5))
        assert push.enviados == []
        verificar_avisos(db, push, abre + timedelta(minutes=1))
        verificar_avisos(db, push, abre + timedelta(minutes=2))
    titulos = [t for _, t, _ in push.enviados]
    assert titulos.count("Antes do turno") == 2  # um por restaurante, uma vez só
    assert all(c.startswith("Hoje é") for _, t, c in push.enviados)

    push.enviados.clear()
    with app.state.sessoes() as db:
        verificar_avisos(db, push, fecha + timedelta(minutes=1))
        verificar_avisos(db, push, fecha + timedelta(minutes=30))
    # Ninguém sentou hoje no teste: o resumo é marcado como feito, mas não incomoda ninguém.
    assert push.enviados == []
    with app.state.sessoes() as db:
        cantina = db.get(Restaurante, cantina_com_historico)
        assert cantina.ultimo_resumo_noite == noite.isoformat()


def test_sem_push_configurado_nada_acontece(app, cantina_com_historico):
    push = PushDeMentira()
    push.ativo = False
    with app.state.sessoes() as db:
        verificar_avisos(db, push, momento_na_noite(noite_de(agora()), "18:00"))
        assert db.get(Restaurante, cantina_com_historico).ultimo_briefing_noite is None
    assert push.enviados == []
