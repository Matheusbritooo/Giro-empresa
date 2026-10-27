"""Resultados, replay e "E se?" pela API: números certos, perfis e isolamento entre restaurantes."""

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from giro.dominio.indicadores import FUSO
from giro.modelos import Mesa, Ocupacao, Restaurante

NOITE = date(2026, 10, 16)


def h(hora: int, minuto: int = 0, dias: int = 0) -> datetime:
    return datetime(2026, 10, 16, hora, minuto, tzinfo=FUSO) + timedelta(days=dias)


@pytest.fixture
def historico(app):
    """Uma sexta na Cantina (e uma na semana anterior) e uma visita na pizzaria vizinha."""
    with app.state.sessoes() as db:
        cantina = db.scalar(select(Restaurante).where(Restaurante.nome == "Cantina do Marcos"))
        vizinha = db.scalar(select(Restaurante).where(Restaurante.nome == "Pizzaria Vizinha"))
        mesa = {
            m.numero: m.id
            for m in db.scalars(select(Mesa).where(Mesa.restaurante_id == cantina.id))
        }
        mesa_vizinha = db.scalar(select(Mesa.id).where(Mesa.restaurante_id == vizinha.id))
        db.add_all(
            [
                Ocupacao(
                    restaurante_id=cantina.id,
                    mesa_id=mesa[1],
                    sentou_em=h(20),
                    atendida_em=h(20, 3),
                    saiu_em=h(20, 40),
                    liberada_em=h(20, 55),
                    pessoas=2,
                ),
                Ocupacao(
                    restaurante_id=cantina.id,
                    mesa_id=mesa[2],
                    sentou_em=h(21, 20),
                    saiu_em=h(21, 35),
                    liberada_em=h(21, 35),
                    pessoas=3,
                    sem_atendimento=True,
                ),
                # Sexta anterior: uma mesa só.
                Ocupacao(
                    restaurante_id=cantina.id,
                    mesa_id=mesa[1],
                    sentou_em=h(20, dias=-7),
                    atendida_em=h(20, 2, dias=-7),
                    saiu_em=h(21, dias=-7),
                    liberada_em=h(21, 4, dias=-7),
                    pessoas=4,
                ),
                Ocupacao(
                    restaurante_id=vizinha.id,
                    mesa_id=mesa_vizinha,
                    sentou_em=h(20),
                    atendida_em=h(20, 1),
                    saiu_em=h(21),
                    liberada_em=h(21, 1),
                    pessoas=9,
                ),
            ]
        )
        db.commit()


def test_resultados_da_noite_comparados_com_a_semana_passada(como, historico):
    r = como("dono@cantina.demo").get("/api/resultados", params={"dia": NOITE.isoformat()})
    assert r.status_code == 200, r.text
    dados = r.json()
    atual, anterior = dados["atual"], dados["anterior"]
    assert (atual["mesas_atendidas"], atual["pessoas_atendidas"]) == (1, 2)
    assert (atual["desistencias"], atual["pessoas_desistiram"]) == (1, 3)
    assert atual["perdido_desistencias_centavos"] == 3 * 8500  # ticket médio padrão: R$ 85
    assert atual["perdido_total_centavos"] >= atual["perdido_desistencias_centavos"]
    assert atual["hora_pico"] == 20
    assert [m["numero"] for m in atual["por_mesa"]] == [1, 2, 3, 4]
    assert anterior["mesas_atendidas"] == 1
    assert anterior["pessoas_atendidas"] == 4
    assert dados["noites"] == []


def test_resultados_da_semana_trazem_cada_noite(como, historico):
    r = como("gerente@cantina.demo").get(
        "/api/resultados", params={"periodo": "semana", "dia": NOITE.isoformat()}
    )
    assert r.status_code == 200, r.text
    noites = r.json()["noites"]
    assert len(noites) == 7
    assert noites[-1]["dia"] == NOITE.isoformat()
    assert noites[-1]["mesas_atendidas"] == 1
    assert r.json()["anterior"]["mesas_atendidas"] == 1  # a sexta da semana passada


def test_replay_traz_so_horarios_da_noite(como, historico):
    r = como("dono@cantina.demo").get("/api/resultados/replay", params={"dia": NOITE.isoformat()})
    assert r.status_code == 200, r.text
    dados = r.json()
    assert len(dados["mesas"]) == 4
    assert len(dados["visitas"]) == 2  # a da semana passada e a da vizinha ficam de fora
    assert set(dados["visitas"][0]) == {
        "mesa_id",
        "sentou_em",
        "atendida_em",
        "saiu_em",
        "liberada_em",
        "pessoas",
        "sem_atendimento",
    }
    assert dados["limite_alerta_seg"] == 300


def test_e_se_com_mais_garcons_recupera_quem_foi_embora(como, historico):
    r = como("dono@cantina.demo").get(
        "/api/resultados/e-se",
        params={
            "periodo": "noite",
            "dia": NOITE.isoformat(),
            "garcons_atual": 2,
            "garcons_novo": 3,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["desistencias_evitadas"] == 1
    assert r.json()["ganho_centavos"] == 3 * 8500


def test_ticket_medio_muda_o_dinheiro_perdido(como, historico):
    dono = como("dono@cantina.demo")
    restaurante_id = dono.get("/api/auth/sessao").json()["restaurante"]["id"]
    r = dono.patch(
        f"/api/restaurantes/{restaurante_id}",
        json={"ticket_medio_centavos": 12000, "abre_as": "18:30", "fecha_as": "00:30"},
    )
    assert r.status_code == 200, r.text
    assert (r.json()["abre_as"], r.json()["fecha_as"]) == ("18:30", "00:30")
    atual = dono.get("/api/resultados", params={"dia": NOITE.isoformat()}).json()["atual"]
    assert atual["perdido_desistencias_centavos"] == 3 * 12000


@pytest.mark.parametrize(
    "corpo", [{"abre_as": "25:00"}, {"fecha_as": "7h"}, {"ticket_medio_centavos": 10}]
)
def test_ajustes_invalidos_sao_recusados(como, corpo):
    dono = como("dono@cantina.demo")
    restaurante_id = dono.get("/api/auth/sessao").json()["restaurante"]["id"]
    assert dono.patch(f"/api/restaurantes/{restaurante_id}", json=corpo).status_code == 422


def test_equipe_nao_ve_resultados(como, historico):
    equipe = como("equipe@cantina.demo")
    for caminho in ("/api/resultados", "/api/resultados/replay", "/api/resultados/e-se"):
        assert equipe.get(caminho).status_code == 403


def test_um_restaurante_nao_ve_os_resultados_do_outro(como, historico):
    vizinho = como("dono@vizinha.demo")
    cantina_id = como("dono@cantina.demo").get("/api/auth/sessao").json()["restaurante"]["id"]
    for caminho in ("/api/resultados", "/api/resultados/replay", "/api/resultados/e-se"):
        assert vizinho.get(caminho, params={"restaurante_id": cantina_id}).status_code == 404
    # Sem pedir outro restaurante, o vizinho só vê os próprios números.
    proprio = vizinho.get("/api/resultados", params={"dia": NOITE.isoformat()}).json()
    assert proprio["atual"]["pessoas_atendidas"] == 9


def test_admin_giro_escolhe_o_restaurante(como, historico):
    admin = como("admin@giro.demo")
    assert admin.get("/api/resultados").status_code == 400
    cantina_id = como("dono@cantina.demo").get("/api/auth/sessao").json()["restaurante"]["id"]
    r = admin.get(
        "/api/resultados", params={"restaurante_id": cantina_id, "dia": NOITE.isoformat()}
    )
    assert r.json()["atual"]["pessoas_atendidas"] == 2
