from functools import lru_cache

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SEGREDO_DEV = "dev-inseguro-troque-este-segredo-em-producao"


class Config(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GIRO_", env_file=".env", extra="ignore", populate_by_name=True
    )

    ambiente: str = "dev"  # dev | teste | producao
    database_url: str = "sqlite:///./giro-dev.db"

    segredo_jwt: str = SEGREDO_DEV
    sessao_horas: int = 12
    cookie_seguro: bool = False  # True em produção (só HTTPS)

    origens_cors: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Notificação no celular (Web Push). Gere com: uv run python -m giro.vapid
    vapid_chave_privada: str | None = None
    vapid_chave_publica: str | None = None
    vapid_contato: str = "mailto:contato@giro.demo"

    # Serviço de visão (Fase 2), usado para mostrar a prévia da câmera ao desenhar as mesas.
    # O segredo é o mesmo configurado no serviço de visão (GIRO_VISAO_SEGREDO).
    visao_url: str | None = None
    visao_segredo: str | None = None

    # Copiloto GIRO com IA (Claude). Sem chave, o Copiloto responde com regras fixas.
    # Aceita GIRO_ANTHROPIC_API_KEY ou o nome padrão do SDK, ANTHROPIC_API_KEY.
    anthropic_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GIRO_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
    )

    # De quanto em quanto tempo o servidor confere alertas que dependem só do relógio.
    # 0 desliga (usado nos testes).
    verificador_intervalo_seg: float = 10

    @field_validator("database_url")
    @classmethod
    def _driver_do_postgres(cls, valor: str) -> str:
        # Render e outras plataformas entregam postgres:// ou postgresql://; o SQLAlchemy
        # precisa saber que o driver é o psycopg 3.
        for prefixo in ("postgres://", "postgresql://"):
            if valor.startswith(prefixo):
                return "postgresql+psycopg://" + valor.removeprefix(prefixo)
        return valor

    @field_validator("segredo_jwt")
    @classmethod
    def _segredo_longo(cls, valor: str) -> str:
        if len(valor) < 32:
            raise ValueError("GIRO_SEGREDO_JWT precisa ter pelo menos 32 caracteres")
        return valor

    def validar_producao(self) -> None:
        if self.ambiente != "producao":
            return
        if self.segredo_jwt == SEGREDO_DEV:
            raise RuntimeError("GIRO_SEGREDO_JWT precisa ser definido em produção")
        if not self.cookie_seguro:
            raise RuntimeError("GIRO_COOKIE_SEGURO precisa ser true em produção")


@lru_cache
def obter_config() -> Config:
    return Config()
