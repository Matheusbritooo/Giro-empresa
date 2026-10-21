from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SEGREDO_DEV = "dev-inseguro-troque-este-segredo-em-producao"


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GIRO_", env_file=".env", extra="ignore")

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

    # De quanto em quanto tempo o servidor confere alertas que dependem só do relógio.
    # 0 desliga (usado nos testes).
    verificador_intervalo_seg: float = 10

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
