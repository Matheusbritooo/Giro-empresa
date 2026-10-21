import os

import pytest
from fastapi.testclient import TestClient

from giro.api.app import criar_app
from giro.banco import Base
from giro.config import Config
from giro.modelos import Camera, Mesa, Papel, Restaurante, Usuario
from giro.seguranca import gerar_hash_senha, hash_token

SENHA = "senha-de-teste"
TOKEN_CAMERA = "cam_teste_cantina"
TOKEN_CAMERA_OUTRO = "cam_teste_outro"
ORIGEM = "http://localhost:3000"
SENHA_HASH = gerar_hash_senha(SENHA)  # uma vez só: o hash de senha é lento de propósito


@pytest.fixture
def config(tmp_path):
    # Por padrão usa SQLite. Para testar contra Postgres (como na CI):
    # GIRO_TESTE_DATABASE_URL=postgresql+psycopg://giro:giro@localhost:5432/giro_teste
    url = os.environ.get("GIRO_TESTE_DATABASE_URL") or f"sqlite:///{tmp_path / 'teste.db'}"
    return Config(
        ambiente="teste",
        database_url=url,
        segredo_jwt="segredo-de-teste-com-tamanho-suficiente-para-hs256",
        verificador_intervalo_seg=0,
        origens_cors=[ORIGEM],
    )


@pytest.fixture
def app(config):
    app = criar_app(config)
    engine = app.state.sessoes.kw["bind"]
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with app.state.sessoes() as db:
        cantina = Restaurante(nome="Cantina do Marcos", cidade="Cotia")
        outro = Restaurante(nome="Pizzaria Vizinha", cidade="Osasco")
        db.add_all([cantina, outro])
        db.flush()
        for email, papel, restaurante in [
            ("admin@giro.demo", Papel.ADMIN_GIRO, None),
            ("dono@cantina.demo", Papel.DONO, cantina),
            ("gerente@cantina.demo", Papel.GERENTE, cantina),
            ("equipe@cantina.demo", Papel.EQUIPE, cantina),
            ("dono@vizinha.demo", Papel.DONO, outro),
        ]:
            db.add(
                Usuario(
                    restaurante_id=restaurante.id if restaurante else None,
                    nome=email.split("@")[0].title(),
                    email=email,
                    senha_hash=SENHA_HASH,
                    papel=papel.value,
                )
            )
        db.add(Camera(restaurante_id=cantina.id, nome="Salão", token_hash=hash_token(TOKEN_CAMERA)))
        db.add(
            Camera(restaurante_id=outro.id, nome="Salão", token_hash=hash_token(TOKEN_CAMERA_OUTRO))
        )
        for numero in range(1, 5):
            db.add(Mesa(restaurante_id=cantina.id, numero=numero, pos_x=numero - 1))
        db.add(Mesa(restaurante_id=outro.id, numero=1))
        db.commit()
    return app


@pytest.fixture
def cliente(app):
    with TestClient(app) as cliente:
        yield cliente


def entrar(cliente: TestClient, email: str) -> TestClient:
    resposta = cliente.post("/api/auth/entrar", json={"email": email, "senha": SENHA})
    assert resposta.status_code == 200, resposta.text
    return cliente


@pytest.fixture
def como(app, cliente):
    """Cliente logado com o e-mail pedido: como("gerente@cantina.demo").

    Depende de `cliente` para a API estar ligada (ciclo de vida rodando) durante o teste.
    """

    def abrir(email: str) -> TestClient:
        return entrar(TestClient(app), email)

    return abrir


@pytest.fixture
def camera(cliente):
    def enviar(observacoes, em=None, token=TOKEN_CAMERA):
        corpo = {"mesas": observacoes}
        if em is not None:
            corpo["em"] = em.isoformat()
        return cliente.post(
            "/api/ingest/observacoes",
            json=corpo,
            headers={"authorization": f"Bearer {token}"},
        )

    return enviar
