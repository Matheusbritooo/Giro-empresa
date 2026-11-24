"""Histórico de quem fez o quê (só o dono) e primeiros passos (dono e gerente)."""

from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select

from giro.api.deps import GESTAO, Db, RestauranteAlvo, UsuarioAtual, exigir_papel
from giro.banco import agora
from giro.dominio.indicadores import FUSO
from giro.modelos import Atividade, Papel, Restaurante, Usuario
from giro.servicos.atividades import GrupoAtividade
from giro.servicos.primeiros_passos import SO_DONO, primeiros_passos, restaurante_novo

router = APIRouter(prefix="/api", tags=["histórico e primeiros passos"])

LIMITE = 300  # linhas por vez na tela
DIAS = {"semana": 7, "mes": 30, "trimestre": 90}


class AtividadeSaida(BaseModel):
    id: int
    em: datetime
    grupo: GrupoAtividade
    texto: str
    quem: str | None  # vazio: o próprio GIRO (ou alguém que já saiu do cadastro)
    usuario_id: int | None


class PessoaSaida(BaseModel):
    id: int
    nome: str


class HistoricoSaida(BaseModel):
    hoje: date  # o dia de hoje em São Paulo (para a tela escrever "Hoje" e "Ontem")
    atividades: list[AtividadeSaida]
    pessoas: list[PessoaSaida]  # quem aparece no período, para o filtro
    mais: bool  # passou do limite: filtre para ver o resto


@router.get("/atividades", dependencies=[exigir_papel(Papel.DONO, Papel.ADMIN_GIRO)])
def ver_historico(
    db: Db,
    restaurante_id: RestauranteAlvo,
    periodo: Annotated[Literal["semana", "mes", "trimestre"], Query()] = "semana",
    grupo: Annotated[GrupoAtividade | None, Query()] = None,
    pessoa: Annotated[int | None, Query(ge=1)] = None,
) -> HistoricoSaida:
    """Do mais novo para o mais antigo. Só o dono: tem preço, custo e o nome de quem mexeu."""
    momento = agora()
    desde = momento - timedelta(days=DIAS[periodo])
    filtro = [Atividade.restaurante_id == restaurante_id, Atividade.em >= desde]
    pessoas = db.execute(
        select(Usuario.id, Usuario.nome)
        .join(Atividade, Atividade.usuario_id == Usuario.id)
        .where(*filtro)
        .distinct()
        .order_by(Usuario.nome)
    ).all()
    if grupo is not None:
        filtro.append(Atividade.grupo == grupo.value)
    if pessoa is not None:
        filtro.append(Atividade.usuario_id == pessoa)
    linhas = db.execute(
        select(Atividade, Usuario.nome)
        .outerjoin(Usuario, Atividade.usuario_id == Usuario.id)
        .where(*filtro)
        .order_by(Atividade.em.desc(), Atividade.id.desc())
        .limit(LIMITE + 1)
    ).all()
    return HistoricoSaida(
        hoje=momento.astimezone(FUSO).date(),
        atividades=[
            AtividadeSaida(
                id=a.id,
                em=a.em,
                grupo=GrupoAtividade(a.grupo),
                texto=a.texto,
                quem=nome,
                usuario_id=a.usuario_id,
            )
            for a, nome in linhas[:LIMITE]
        ],
        pessoas=[PessoaSaida(id=i, nome=n) for i, n in pessoas],
        mais=len(linhas) > LIMITE,
    )


class PassoSaida(BaseModel):
    id: str
    titulo: str
    porque: str
    feito: bool
    href: str | None  # vazio: quem está vendo não abre essa tela (o dono faz)


class PrimeirosPassosSaida(BaseModel):
    novo: bool  # ainda começando: a tela Hoje mostra a lista enquanto falta algum passo
    feitos: int
    total: int
    passos: list[PassoSaida]


@router.get("/primeiros-passos", dependencies=[exigir_papel(*GESTAO)])
def ver_primeiros_passos(
    db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo
) -> PrimeirosPassosSaida:
    passos = primeiros_passos(db, db.get_one(Restaurante, restaurante_id))
    dono = usuario.papel in SO_DONO
    return PrimeirosPassosSaida(
        novo=restaurante_novo(db, restaurante_id, agora()),
        feitos=sum(p.feito for p in passos),
        total=len(passos),
        passos=[
            PassoSaida(
                id=p.id,
                titulo=p.titulo,
                porque=p.porque,
                feito=p.feito,
                href=p.href if dono or not p.so_dono else None,
            )
            for p in passos
        ],
    )
