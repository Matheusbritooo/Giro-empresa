"""Formato dos dados que entram e saem da API (e das mensagens ao vivo)."""

from datetime import datetime
from typing import Annotated
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from giro.modelos import Papel


class Saida(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# Sessão e usuários


class LoginEntrada(BaseModel):
    email: str
    senha: str


class RestauranteSaida(Saida):
    id: int
    nome: str
    cidade: str | None
    alerta_atendimento_seg: int


class UsuarioSaida(Saida):
    id: int
    nome: str
    email: str
    papel: Papel
    ativo: bool
    restaurante_id: int | None


class SessaoSaida(BaseModel):
    usuario: UsuarioSaida
    restaurante: RestauranteSaida | None


def _email_valido(valor: str) -> str:
    valor = valor.strip().lower()
    if "@" not in valor or valor.startswith("@") or valor.endswith("@"):
        raise ValueError("e-mail inválido")
    return valor


class UsuarioEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: str
    senha: str = Field(min_length=8, max_length=128)
    papel: Papel

    _email = field_validator("email")(_email_valido)


class UsuarioAtualizacao(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    papel: Papel | None = None
    ativo: bool | None = None


class DonoEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: str
    senha: str = Field(min_length=8, max_length=128)

    _email = field_validator("email")(_email_valido)


class RestauranteEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    cidade: str | None = Field(default=None, max_length=80)
    dono: DonoEntrada


class RestauranteAtualizacao(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    cidade: str | None = Field(default=None, max_length=80)
    alerta_atendimento_seg: int | None = Field(default=None, ge=60, le=1800)


# Mesas e salão


class MesaEntrada(BaseModel):
    numero: int = Field(ge=1, le=999)
    lugares: int = Field(default=4, ge=1, le=30)
    pos_x: int = Field(default=0, ge=0, le=30)
    pos_y: int = Field(default=0, ge=0, le=30)


# Ponto do desenho da mesa sobre a imagem da câmera: x e y de 0 a 1 (0,0 = canto superior esquerdo).
PontoImagem = tuple[Annotated[float, Field(ge=0, le=1)], Annotated[float, Field(ge=0, le=1)]]


class MesaAtualizacao(BaseModel):
    numero: int | None = Field(default=None, ge=1, le=999)
    lugares: int | None = Field(default=None, ge=1, le=30)
    pos_x: int | None = Field(default=None, ge=0, le=30)
    pos_y: int | None = Field(default=None, ge=0, le=30)
    ativa: bool | None = None
    # Desenho da mesa e câmera que a vê. Mandar null apaga.
    camera_id: int | None = None
    poligono: list[PontoImagem] | None = Field(default=None, min_length=3, max_length=30)


class MesaSalao(BaseModel):
    """Uma mesa como aparece no mapa ao vivo."""

    id: int
    numero: int
    lugares: int
    pos_x: int
    pos_y: int
    ativa: bool
    estado: str
    estado_desde: datetime | None
    camera_id: int | None = None
    poligono: list[tuple[float, float]] | None = None
    sentou_em: datetime | None = None
    atendida_em: datetime | None = None
    saiu_em: datetime | None = None
    pessoas: int = 0


class AlertaSaida(BaseModel):
    id: int
    tipo: str
    mesa_id: int
    mesa_numero: int
    criado_em: datetime
    reconhecido_em: datetime | None
    resolvido_em: datetime | None


class AjustesVisao(BaseModel):
    """Calibração da visão por câmera. Os limites evitam um valor que desligue a detecção."""

    proporcao_em_pe: float | None = Field(default=None, ge=1.0, le=5.0)
    margem_atendimento: float | None = Field(default=None, ge=0, le=0.3)
    confianca_minima: float | None = Field(default=None, ge=0.1, le=0.95)


class CameraSaida(Saida):
    id: int
    nome: str
    ativa: bool
    ultima_observacao_em: datetime | None
    ajustes_visao: dict[str, float] | None = None


class CameraCriada(CameraSaida):
    token: str  # aparece só uma vez


class CameraEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=80)


class CameraAtualizacao(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=80)
    ativa: bool | None = None
    ajustes_visao: AjustesVisao | None = None


class ZonaMesaSaida(BaseModel):
    numero: int
    poligono: list[tuple[float, float]]


class ConfiguracaoCamera(BaseModel):
    """O que o serviço de visão precisa saber da câmera para ler a foto."""

    camera_id: int
    restaurante_id: int
    mesas: list[ZonaMesaSaida]
    ajustes: dict[str, float]


class SalaoSaida(BaseModel):
    restaurante: RestauranteSaida
    mesas: list[MesaSalao]
    alertas: list[AlertaSaida]
    cameras: list[CameraSaida]
    agora: datetime


# Entrada de dados da câmera (simulador hoje, visão computacional na Fase 2)


class ObservacaoMesa(BaseModel):
    mesa: int = Field(description="número da mesa")
    sentados: int = Field(ge=0, le=50)
    em_pe: int = Field(default=0, ge=0, le=50)


class ObservacoesEntrada(BaseModel):
    em: datetime | None = Field(default=None, description="hora da foto; vazio = agora")
    mesas: list[ObservacaoMesa] = Field(max_length=200)

    @field_validator("em")
    @classmethod
    def _com_fuso(cls, valor: datetime | None) -> datetime | None:
        if valor is not None and valor.tzinfo is None:
            raise ValueError("informe a hora com fuso horário (ex.: 2026-10-23T20:41:00-03:00)")
        return valor


# Push

HOSTS_PUSH = (
    "fcm.googleapis.com",  # Chrome, Edge e Android
    "android.googleapis.com",
    "updates.push.services.mozilla.com",  # Firefox
    "push.apple.com",  # Safari e iPhone
    "notify.windows.com",
)


class ChavesPush(BaseModel):
    p256dh: str = Field(max_length=255)
    auth: str = Field(max_length=255)


class InscricaoPushEntrada(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: ChavesPush

    @field_validator("endpoint")
    @classmethod
    def _servico_de_push_conhecido(cls, valor: str) -> str:
        # O servidor faz requisição para este endereço: só aceitamos os serviços de push dos
        # navegadores, para ninguém usar a GIRO para acessar endereços internos.
        url = urlparse(valor)
        host = url.hostname or ""
        if url.scheme != "https" or not any(
            host == h or host.endswith("." + h) for h in HOSTS_PUSH
        ):
            raise ValueError("endpoint de push não reconhecido")
        return valor


class ChavePublicaPush(BaseModel):
    chave_publica: str | None


# Leitura da câmera (vem do serviço de visão)


class PessoaLidaSaida(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    em_pe: bool
    mesa: int | None


class LeituraCamera(BaseModel):
    """Última leitura da câmera, para conferir o desenho das mesas. Sem imagem."""

    em: datetime
    pessoas: list[PessoaLidaSaida]
    mesas: list[ObservacaoMesa]
