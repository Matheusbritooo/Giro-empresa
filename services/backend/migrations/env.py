"""Migrações do banco. A URL vem de GIRO_DATABASE_URL (mesma configuração da API)."""

from logging.config import fileConfig

from alembic import context

from giro import modelos  # noqa: F401  (registra as tabelas no metadata)
from giro.banco import Base, DataHora, criar_engine
from giro.config import obter_config

config_alembic = context.config
if config_alembic.config_file_name:
    fileConfig(config_alembic.config_file_name)
metadata = Base.metadata


def renderizar_tipo(tipo, objeto, _contexto):
    """Grava o tipo de data do banco puro, para a migração não depender do código da API."""
    if tipo == "type" and isinstance(objeto, DataHora):
        return "sa.DateTime(timezone=True)"
    return False


def rodar_offline() -> None:
    context.configure(
        url=obter_config().database_url,
        target_metadata=metadata,
        literal_binds=True,
        render_as_batch=True,
        render_item=renderizar_tipo,
    )
    with context.begin_transaction():
        context.run_migrations()


def rodar_online() -> None:
    url = config_alembic.attributes.get("database_url") or obter_config().database_url
    engine = criar_engine(url)
    with engine.connect() as conexao:
        context.configure(
            connection=conexao,
            target_metadata=metadata,
            # SQLite não altera colunas direto; o modo batch recria a tabela quando precisa.
            render_as_batch=conexao.dialect.name == "sqlite",
            compare_type=True,
            render_item=renderizar_tipo,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    rodar_offline()
else:
    rodar_online()
