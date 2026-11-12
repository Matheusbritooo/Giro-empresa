"""A tela "Hoje": a noite até agora e o que pede atenção. Só dono, gerente e admin GIRO."""

from fastapi import APIRouter
from pydantic import BaseModel

from giro.api.deps import GESTAO, Db, RestauranteAlvo, UsuarioAtual, exigir_papel
from giro.api.rotas.cardapio import VEEM_CUSTO
from giro.banco import agora
from giro.modelos import Restaurante
from giro.servicos.hoje import painel_de_hoje

router = APIRouter(prefix="/api/hoje", tags=["hoje"], dependencies=[exigir_papel(*GESTAO)])


class NoiteSaida(BaseModel):
    mesas_atendidas: int
    pessoas_atendidas: int
    desistencias: int
    vendeu_centavos: int
    ficou_na_mesa_centavos: int
    espera_media_seg: float | None
    parada_media_seg: float | None


class CostumaSaida(BaseModel):
    noites: int  # quantas noites iguais entraram na média
    mesas_atendidas: int
    hora_pico: int | None


class PendenciaSaida(BaseModel):
    tipo: str
    texto: str
    href: str
    urgente: bool


class HojeSaida(BaseModel):
    dia: str
    dia_semana: str
    noite: NoiteSaida
    costuma: CostumaSaida | None
    pendencias: list[PendenciaSaida]
    esperar: list[str]
    dicas: list[str]


@router.get("")
def ver_hoje(db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo) -> HojeSaida:
    """Custo (perdas em reais e preço que subiu) só entra para quem vê custo: o dono."""
    restaurante = db.get_one(Restaurante, restaurante_id)
    hoje = painel_de_hoje(db, restaurante, agora(), usuario.papel in VEEM_CUSTO)
    return HojeSaida(
        dia=hoje.dia.isoformat(),
        dia_semana=hoje.dia_semana,
        noite=NoiteSaida(
            mesas_atendidas=hoje.noite.mesas_atendidas,
            pessoas_atendidas=hoje.noite.pessoas_atendidas,
            desistencias=hoje.noite.desistencias,
            vendeu_centavos=hoje.vendeu_centavos,
            ficou_na_mesa_centavos=hoje.noite.perdido_total_centavos,
            espera_media_seg=hoje.noite.espera_media_seg,
            parada_media_seg=hoje.noite.parada_media_seg,
        ),
        costuma=(
            CostumaSaida(
                noites=hoje.noites_iguais,
                mesas_atendidas=hoje.costuma_mesas,
                hora_pico=hoje.hora_pico,
            )
            if hoje.costuma_mesas is not None
            else None
        ),
        pendencias=[PendenciaSaida(**vars(p)) for p in hoje.pendencias],
        esperar=hoje.esperar,
        dicas=hoje.dicas,
    )
