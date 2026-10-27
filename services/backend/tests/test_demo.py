"""Servidor de demonstração (Render): seed em produção, senha própria e salão zerado ao subir."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from giro.banco import Base, agora, criar_engine, criar_sessoes
from giro.config import Config
from giro.modelos import Alerta, Camera, Mesa, Ocupacao, Usuario
from giro.seed import semear
from giro.seguranca import hash_token, verificar_senha

SEGREDO = "segredo-de-teste-com-tamanho-suficiente-para-hs256"


@pytest.fixture
def config_producao(tmp_path):
    config = Config(
        ambiente="producao",
        database_url=f"sqlite:///{tmp_path / 'demo.db'}",
        segredo_jwt=SEGREDO,
        cookie_seguro=True,
    )
    Base.metadata.create_all(criar_engine(config.database_url))
    return config


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv("GIRO_DEMO", "1")
    monkeypatch.setenv("GIRO_SENHA_DEMO", "senha-da-banca-2026")
    monkeypatch.setenv("GIRO_TOKEN_CAMERA_DEMO", "cam_do_servidor_de_demo")


def sessao(config):
    return criar_sessoes(criar_engine(config.database_url))()


@pytest.mark.parametrize(
    "url",
    ["postgres://u:s@banco/giro", "postgresql://u:s@banco/giro"],
)
def test_endereco_do_banco_da_plataforma_ganha_o_driver(url):
    config = Config(database_url=url)
    assert config.database_url == "postgresql+psycopg://u:s@banco/giro"


def test_seed_em_producao_so_no_servidor_de_demonstracao(config_producao, monkeypatch):
    monkeypatch.delenv("GIRO_DEMO", raising=False)
    with pytest.raises(SystemExit, match="GIRO_DEMO"):
        semear(config_producao)
    monkeypatch.setenv("GIRO_DEMO", "1")
    monkeypatch.setenv("GIRO_SENHA_DEMO", "giro1234")  # a senha conhecida do README não vale
    with pytest.raises(SystemExit, match="10 caracteres"):
        semear(config_producao)
    monkeypatch.setenv("GIRO_SENHA_DEMO", "senha-da-banca-2026")
    monkeypatch.setenv("GIRO_TOKEN_CAMERA_DEMO", "cam_demo_cantina_do_marcos")
    with pytest.raises(SystemExit, match="GIRO_TOKEN_CAMERA_DEMO"):
        semear(config_producao)


def test_demonstracao_usa_a_senha_e_o_token_do_servidor(config_producao, demo, monkeypatch, capsys):
    semear(config_producao)
    assert "senha-da-banca-2026" not in capsys.readouterr().out
    with sessao(config_producao) as db:
        usuario = db.scalar(select(Usuario).where(Usuario.email == "gerente@cantina.demo"))
        assert verificar_senha(usuario.senha_hash, "senha-da-banca-2026")
        assert db.scalar(select(Camera)).token_hash == hash_token("cam_do_servidor_de_demo")

    monkeypatch.setenv("GIRO_SENHA_DEMO", "outra-senha-trocada")
    monkeypatch.setenv("GIRO_TOKEN_CAMERA_DEMO", "cam_token_novo_do_servidor")
    semear(config_producao)
    with sessao(config_producao) as db:
        usuario = db.scalar(select(Usuario).where(Usuario.email == "gerente@cantina.demo"))
        assert verificar_senha(usuario.senha_hash, "outra-senha-trocada")
        assert db.scalar(select(Camera)).token_hash == hash_token("cam_token_novo_do_servidor")
        assert len(db.scalars(select(Usuario)).all()) == 4  # não duplicou


def test_salao_zerado_ao_subir(config_producao, demo):
    semear(config_producao)
    antes = agora() - timedelta(minutes=30)
    with sessao(config_producao) as db:
        mesa = db.scalar(select(Mesa).where(Mesa.numero == 4))
        mesa.estado, mesa.estado_maquina = "aguardando", {"qualquer": "coisa"}
        ocupacao = Ocupacao(restaurante_id=mesa.restaurante_id, mesa_id=mesa.id, sentou_em=antes)
        db.add(ocupacao)
        db.flush()
        db.add(
            Alerta(
                restaurante_id=mesa.restaurante_id,
                mesa_id=mesa.id,
                ocupacao_id=ocupacao.id,
                tipo="sem_atendimento",
                criado_em=antes,
            )
        )
        db.commit()

    semear(config_producao, zerar=True)
    with sessao(config_producao) as db:
        assert {m.estado for m in db.scalars(select(Mesa))} == {"livre"}
        assert db.scalar(select(Mesa).where(Mesa.numero == 4)).estado_maquina is None
        ocupacao = db.scalar(select(Ocupacao))
        assert ocupacao.liberada_em is not None and ocupacao.saiu_em is not None
        assert db.scalar(select(Alerta)).resolvido_em is not None


def test_demonstracao_ganha_4_semanas_de_historico_uma_vez_so(config_producao, demo):
    semear(config_producao)
    with sessao(config_producao) as db:
        visitas = len(db.scalars(select(Ocupacao)).all())
        assert visitas > 300  # 4 semanas de jantar, fechado às segundas
        assert db.scalar(select(Ocupacao).where(Ocupacao.sentou_em > agora())) is None
    semear(config_producao, zerar=True)
    with sessao(config_producao) as db:
        assert len(db.scalars(select(Ocupacao)).all()) == visitas  # não duplicou


def test_ao_acordar_as_noites_passadas_viram_historico_e_hoje_fica(config_producao, demo):
    semear(config_producao)
    with sessao(config_producao) as db:
        mesa = db.scalar(select(Mesa).where(Mesa.numero == 4))
        historico = len(db.scalars(select(Ocupacao)).all())
        # O simulador rodou dois dias atrás, à tarde (fora de hora), e agora há pouco.
        solta = Ocupacao(
            restaurante_id=mesa.restaurante_id,
            mesa_id=mesa.id,
            sentou_em=agora().replace(hour=18) - timedelta(days=2, hours=3),
        )
        de_hoje = Ocupacao(
            restaurante_id=mesa.restaurante_id,
            mesa_id=mesa.id,
            sentou_em=agora() - timedelta(minutes=1),
        )
        db.add_all([solta, de_hoje])
        db.flush()
        db.add(
            Alerta(
                restaurante_id=mesa.restaurante_id,
                mesa_id=mesa.id,
                ocupacao_id=solta.id,
                tipo="sem_atendimento",
                criado_em=solta.sentou_em,
            )
        )
        db.commit()
        ids = (solta.id, de_hoje.id)

    semear(config_producao, zerar=True, refazer=True)
    with sessao(config_producao) as db:
        assert db.get(Ocupacao, ids[0]) is None
        assert db.get(Ocupacao, ids[1]) is not None
        assert db.scalar(select(Alerta).where(Alerta.ocupacao_id == ids[0])) is None
        assert len(db.scalars(select(Ocupacao)).all()) == historico + 1
