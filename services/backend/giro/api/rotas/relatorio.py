"""O relatório do mês, para imprimir em PDF ou baixar como planilha. Dono, gerente e admin
GIRO; a parte de custo (CMV, compras e o que escapou do estoque) só para quem vê custo."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from giro.api.deps import GESTAO, Db, RestauranteAlvo, UsuarioAtual, exigir_papel
from giro.api.rotas.cardapio import VEEM_CUSTO
from giro.banco import agora
from giro.dominio.indicadores import noite_de
from giro.esquemas import NotasSaida
from giro.modelos import Restaurante
from giro.servicos.relatorio import relatorio_do_mes

router = APIRouter(
    prefix="/api/relatorios", tags=["relatório do mês"], dependencies=[exigir_papel(*GESTAO)]
)

Mes = Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="AAAA-MM")]


class NoiteDoMesSaida(BaseModel):
    dia: date
    mesas_atendidas: int
    pessoas: int
    desistencias: int
    vendeu_centavos: int
    ficou_na_mesa_centavos: int
    espera_media_seg: float | None
    parada_media_seg: float | None
    nota_media: float | None


class SemanaSaida(BaseModel):
    de: date
    ate: date
    mesas_atendidas: int
    vendeu_centavos: int


class ItemDoMesSaida(BaseModel):
    nome: str
    quantidade: int
    receita_centavos: int


class MotivoSaida(BaseModel):
    motivo: str
    valor_centavos: int | None


class CustoDoMesSaida(BaseModel):
    custo_pela_ficha_centavos: int
    escapou_centavos: int
    compras_centavos: int
    itens_sem_custo: list[str]
    por_motivo: list[MotivoSaida]


class CaixaDoMesSaida(BaseModel):
    noites: int  # noites do mês que vieram do caixa
    caixa_centavos: int
    giro_centavos: int  # o que foi lançado no GIRO nessas mesmas noites


class RelatorioSaida(BaseModel):
    restaurante: str
    mes: date
    primeira_noite: date
    ultima_noite: date
    completo: bool
    # As noites do mês anterior com que os "_antes" se comparam; vazio = sem comparação (o GIRO
    # ainda não estava em uso no começo do mês anterior).
    comparado_de: date | None
    comparado_ate: date | None
    vendeu_centavos: int
    vendeu_antes_centavos: int
    mesas_atendidas: int
    mesas_atendidas_antes: int
    pessoas: int
    desistencias: int
    giro_medio: float
    ticket_medio_centavos: int
    ticket_real: bool
    espera_media_seg: float | None
    parada_media_seg: float | None
    ficou_na_mesa_centavos: int
    ficou_na_mesa_antes_centavos: int
    notas: NotasSaida
    semanas: list[SemanaSaida]
    pratos: list[ItemDoMesSaida]
    noites: list[NoiteDoMesSaida]
    custo: CustoDoMesSaida | None
    caixa: CaixaDoMesSaida | None  # só com a planilha do caixa importada no mês


@router.get("/mes")
def ver_relatorio(
    db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo, mes: Mes = None
) -> RelatorioSaida:
    momento = agora()
    este_mes = noite_de(momento).replace(day=1)
    escolhido = date.fromisoformat(f"{mes}-01") if mes else este_mes
    if escolhido > este_mes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "esse mês ainda não começou")
    restaurante = db.get_one(Restaurante, restaurante_id)
    r = relatorio_do_mes(db, restaurante, escolhido, momento, usuario.papel in VEEM_CUSTO)
    return RelatorioSaida(
        restaurante=restaurante.nome,
        mes=r.mes,
        primeira_noite=r.primeira_noite,
        ultima_noite=r.ultima_noite,
        completo=r.completo,
        comparado_de=r.comparacao[0] if r.comparacao else None,
        comparado_ate=r.comparacao[1] if r.comparacao else None,
        vendeu_centavos=r.vendeu_centavos,
        vendeu_antes_centavos=r.vendeu_antes_centavos,
        mesas_atendidas=r.atual.mesas_atendidas,
        mesas_atendidas_antes=r.anterior.mesas_atendidas,
        pessoas=r.pessoas,
        desistencias=r.atual.desistencias,
        giro_medio=r.atual.giro_medio,
        ticket_medio_centavos=r.atual.ticket_medio_centavos,
        ticket_real=r.atual.ticket_real,
        espera_media_seg=r.atual.espera_media_seg,
        parada_media_seg=r.atual.parada_media_seg,
        ficou_na_mesa_centavos=r.atual.perdido_total_centavos,
        ficou_na_mesa_antes_centavos=r.anterior.perdido_total_centavos,
        notas=NotasSaida.model_validate(r.notas),
        semanas=[
            SemanaSaida(de=de, ate=ate, mesas_atendidas=m, vendeu_centavos=v)
            for de, ate, m, v in r.semanas
        ],
        pratos=[ItemDoMesSaida.model_validate(p, from_attributes=True) for p in r.pratos],
        noites=[NoiteDoMesSaida.model_validate(n, from_attributes=True) for n in r.noites],
        custo=(
            CustoDoMesSaida(
                custo_pela_ficha_centavos=r.custo.custo_pela_ficha_centavos,
                escapou_centavos=r.custo.escapou_centavos,
                compras_centavos=r.custo.compras_centavos,
                itens_sem_custo=r.custo.itens_sem_custo,
                por_motivo=[
                    MotivoSaida(motivo=m.motivo, valor_centavos=m.valor_centavos)
                    for m in r.custo.por_motivo
                ],
            )
            if r.custo is not None
            else None
        ),
        caixa=(
            CaixaDoMesSaida(
                noites=len(r.caixa.noites),
                caixa_centavos=r.caixa.caixa_centavos,
                giro_centavos=r.caixa.giro_centavos,
            )
            if r.caixa is not None
            else None
        ),
    )
