from types import SimpleNamespace

import pytest
from pywebpush import WebPushException
from sqlalchemy import select

from giro.modelos import InscricaoPush, Papel, Usuario
from giro.push import EnviadorPush
from giro.vapid import gerar


@pytest.fixture
def enviador(app, config):
    privada, publica = gerar()
    config = config.model_copy(
        update={"vapid_chave_privada": privada, "vapid_chave_publica": publica}
    )
    with app.state.sessoes() as db:
        for email in ("gerente@cantina.demo", "equipe@cantina.demo"):
            usuario = db.scalar(select(Usuario).where(Usuario.email == email))
            db.add(
                InscricaoPush(
                    restaurante_id=usuario.restaurante_id,
                    usuario_id=usuario.id,
                    endpoint=f"https://fcm.googleapis.com/fcm/send/{usuario.papel}",
                    p256dh="p",
                    auth="a",
                )
            )
        db.commit()
        restaurante_id = usuario.restaurante_id
    enviador = EnviadorPush(config, app.state.sessoes)
    enviador.restaurante_id = restaurante_id
    yield enviador
    enviador.encerrar()


def test_alerta_de_atendimento_vai_so_para_gestao(enviador, monkeypatch):
    enviados = []
    monkeypatch.setattr(
        "giro.push.webpush", lambda subscription_info, **_: enviados.append(subscription_info)
    )
    enviador._enviar_agora(
        enviador.restaurante_id, "Mesa 2", "teste", (Papel.DONO, Papel.GERENTE), "/salao"
    )
    assert [e["endpoint"].rsplit("/", 1)[1] for e in enviados] == ["gerente"]


def test_inscricao_cancelada_no_celular_e_apagada(app, enviador, monkeypatch):
    def recusar(**_):
        raise WebPushException("sumiu", response=SimpleNamespace(status_code=410))

    monkeypatch.setattr("giro.push.webpush", recusar)
    enviador._enviar_agora(enviador.restaurante_id, "Mesa 2", "teste", tuple(Papel), "/salao")
    with app.state.sessoes() as db:
        assert db.scalars(select(InscricaoPush)).all() == []
