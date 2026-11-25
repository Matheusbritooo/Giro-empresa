"""A planilha do caixa: prévia, importação e conferência com os pedidos. Dono e gerente.

O arquivo vem como texto no corpo do pedido (o painel lê o arquivo no aparelho) e não é
guardado: só ficam as somas por noite e produto (`vendas_caixa`)."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from giro.api.deps import GESTAO, Db, RestauranteAlvo, UsuarioAtual, exigir_papel
from giro.banco import agora
from giro.dominio.caixa import ErroPlanilha
from giro.dominio.indicadores import noite_de
from giro.modelos import ItemCardapio
from giro.servicos import caixa as servico
from giro.servicos.relatorio import primeiro_dia, ultimo_dia

router = APIRouter(prefix="/api/caixa", tags=["caixa"], dependencies=[exigir_papel(*GESTAO)])

Arquivo = Annotated[str, Field(min_length=1, max_length=5_000_000)]


class PlanilhaEntrada(BaseModel):
    arquivo: Arquivo


class NomeSaida(BaseModel):
    nome: str
    quantidade: int
    valor_centavos: int
    sugestao_item_id: int | None


class PreviaSaida(BaseModel):
    de: date
    ate: date
    noites: int
    linhas: int
    ignoradas: int
    total_centavos: int
    colunas: dict[str, str]
    avisos: list[str]
    nomes: list[NomeSaida]
    noites_ja_importadas: int


class Associacao(BaseModel):
    nome: str = Field(max_length=120)
    item_id: int | None


class ImportacaoEntrada(BaseModel):
    arquivo: Arquivo
    associacoes: list[Associacao] = Field(default_factory=list, max_length=2000)


def _previa_saida(p: servico.Previa) -> PreviaSaida:
    return PreviaSaida(
        de=p.de,
        ate=p.ate,
        noites=p.noites,
        linhas=len(p.leitura.linhas),
        ignoradas=p.leitura.ignoradas,
        total_centavos=p.total_centavos,
        colunas=p.leitura.colunas,
        avisos=p.leitura.avisos,
        nomes=[NomeSaida(**vars(n)) for n in p.nomes],
        noites_ja_importadas=p.noites_ja_importadas,
    )


def _erro(erro: ErroPlanilha) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(erro))


@router.post("/previa")
def ver_previa(dados: PlanilhaEntrada, db: Db, restaurante_id: RestauranteAlvo) -> PreviaSaida:
    """Lê a planilha e mostra o que vai entrar, sem gravar nada."""
    try:
        return _previa_saida(servico.previa(db, restaurante_id, dados.arquivo))
    except ErroPlanilha as erro:
        raise _erro(erro) from erro


@router.post("/importar", status_code=status.HTTP_201_CREATED)
def importar(
    dados: ImportacaoEntrada, db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo
) -> PreviaSaida:
    """Grava as somas por noite e produto. As noites que já tinham sido importadas são trocadas."""
    associacoes = {a.nome: a.item_id for a in dados.associacoes}
    pedidos = {i for i in associacoes.values() if i is not None}
    do_restaurante = set(
        db.scalars(
            select(ItemCardapio.id).where(
                ItemCardapio.id.in_(pedidos), ItemCardapio.restaurante_id == restaurante_id
            )
        )
    )
    if pedidos - do_restaurante:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item não encontrado no cardápio")
    try:
        feita = servico.importar(db, restaurante_id, usuario, dados.arquivo, associacoes, agora())
    except ErroPlanilha as erro:
        raise _erro(erro) from erro
    return _previa_saida(feita)


class NoiteSaida(BaseModel):
    noite: date
    caixa_centavos: int
    giro_centavos: int


class ItemSaida(BaseModel):
    nome: str
    item_id: int | None
    caixa_quantidade: int
    giro_quantidade: int
    caixa_centavos: int
    giro_centavos: int


class ConferenciaSaida(BaseModel):
    mes: date
    noites: list[NoiteSaida]
    itens: list[ItemSaida]
    caixa_centavos: int
    giro_centavos: int
    sem_associacao: list[str]


@router.get("/conferencia")
def ver_conferencia(
    db: Db,
    restaurante_id: RestauranteAlvo,
    mes: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
) -> ConferenciaSaida:
    """O caixa contra os pedidos do GIRO, nas noites do mês que vieram do caixa."""
    escolhido = date.fromisoformat(f"{mes}-01") if mes else primeiro_dia(noite_de(agora()))
    c = servico.conferencia(db, restaurante_id, escolhido, ultimo_dia(escolhido))
    return ConferenciaSaida(
        mes=escolhido,
        noites=[NoiteSaida(**vars(n)) for n in c.noites],
        itens=[ItemSaida(**vars(i)) for i in c.itens],
        caixa_centavos=c.caixa_centavos,
        giro_centavos=c.giro_centavos,
        sem_associacao=c.sem_associacao,
    )
