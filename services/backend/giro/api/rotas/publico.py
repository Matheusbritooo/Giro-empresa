"""A página do QR da mesa, para o cliente do restaurante: sem login, sem cadastro e sem nada
pessoal. O cliente vê o cardápio de hoje (o que acabou aparece riscado), chama o garçom, pede
a conta e, no fim, dá uma nota de 1 a 5 à visita.

A chave do QR é da mesa, não de quem senta: não diz nada sobre ninguém e não abre nada além
desta página. Quem tem a foto do QR em casa não consegue incomodar a equipe: só chama com a
mesa ocupada, um chamado igual por vez e poucos por minuto. O gerente troca a chave quando
quiser (o QR antigo para de funcionar).
"""

import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from giro.api.deps import Db, Servico
from giro.banco import agora
from giro.dominio.mesa import Estado, TransicaoInvalida
from giro.modelos import (
    Alerta,
    CategoriaCardapio,
    ItemCardapio,
    ItemPedido,
    Mesa,
    Ocupacao,
    Restaurante,
    TipoAlerta,
)
from giro.servicos.compras import plano_de_compras, pratos_do_dia
from giro.servicos.salao import ocupacoes_abertas

router = APIRouter(prefix="/api/publico", tags=["público (QR da mesa)"])

ChaveMesa = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{16,32}$")]
# Depois que a visita termina, ainda dá para avaliar por este tempo (o cliente na porta).
AVALIAR_DEPOIS_DE_SAIR = timedelta(minutes=30)
DESTAQUES = 3


class LimiteChamados:
    """Poucos chamados por mesa num minuto: o botão apertado várias vezes não vira várias
    notificações no celular da equipe."""

    def __init__(self, maximo: int = 4, janela_seg: float = 60) -> None:
        self.maximo = maximo
        self.janela_seg = janela_seg
        self._feitos: dict[str, deque[float]] = defaultdict(deque)

    def permitir(self, chave: str) -> bool:
        agora_s = time.monotonic()
        feitos = self._feitos[chave]
        while feitos and agora_s - feitos[0] > self.janela_seg:
            feitos.popleft()
        if len(feitos) >= self.maximo:
            return False
        feitos.append(agora_s)
        return True


class ItemPublico(BaseModel):
    nome: str
    descricao: str | None
    preco_centavos: int
    disponivel: bool
    sugestao: bool = False  # a casa sugere hoje (ingrediente sobrando no estoque)


class CategoriaPublica(BaseModel):
    nome: str
    bebida: bool
    itens: list[ItemPublico]


class MesaPublicaSaida(BaseModel):
    restaurante: str
    mesa: int
    com_clientes: bool  # dá para chamar o garçom e pedir a conta
    chamados: list[Literal["garcom", "conta"]]  # o que já foi pedido e ainda não atendido
    nota: int | None  # a nota que esta visita já deu
    destaques: list[str]  # os mais pedidos da casa nas últimas 4 semanas
    categorias: list[CategoriaPublica]


class ChamadoEntrada(BaseModel):
    motivo: Literal["garcom", "conta"]


class NotaEntrada(BaseModel):
    nota: int = Field(ge=1, le=5)


class RecadoSaida(BaseModel):
    texto: str


TIPO_DO_MOTIVO = {"garcom": TipoAlerta.CHAMOU_GARCOM, "conta": TipoAlerta.PEDIU_CONTA}


def _mesa(db, chave: str) -> Mesa:
    mesa = db.scalar(select(Mesa).where(Mesa.chave_publica == chave, Mesa.ativa.is_(True)))
    if mesa is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Este QR não vale mais. Peça ajuda a alguém da equipe."
        )
    return mesa


def _visita_para_nota(db, mesa: Mesa) -> Ocupacao | None:
    """A visita em curso, ou a que acabou de sair (o cliente avalia já na porta)."""
    aberta = ocupacoes_abertas(db, [mesa.id]).get(mesa.id)
    if aberta is not None and mesa.estado != Estado.LIVRE:
        return aberta
    return db.scalar(
        select(Ocupacao)
        .where(
            Ocupacao.mesa_id == mesa.id,
            Ocupacao.saiu_em.is_not(None),
            Ocupacao.saiu_em >= agora() - AVALIAR_DEPOIS_DE_SAIR,
            Ocupacao.sem_atendimento.is_(False),
        )
        .order_by(Ocupacao.saiu_em.desc())
        .limit(1)
    )


@router.get("/mesas/{chave}")
def ver_mesa(chave: ChaveMesa, db: Db) -> MesaPublicaSaida:
    mesa = _mesa(db, chave)
    restaurante = db.get_one(Restaurante, mesa.restaurante_id)
    categorias = db.scalars(
        select(CategoriaCardapio)
        .where(
            CategoriaCardapio.restaurante_id == mesa.restaurante_id,
            CategoriaCardapio.ativa.is_(True),
        )
        .order_by(CategoriaCardapio.ordem, CategoriaCardapio.id)
    ).all()
    itens = db.scalars(
        select(ItemCardapio)
        .where(ItemCardapio.restaurante_id == mesa.restaurante_id, ItemCardapio.ativo.is_(True))
        .order_by(ItemCardapio.nome)
    ).all()
    quantidade = func.sum(ItemPedido.quantidade)
    destaques = db.scalars(
        select(ItemCardapio.nome)
        .join(ItemPedido, ItemPedido.item_id == ItemCardapio.id)
        .where(
            ItemPedido.restaurante_id == mesa.restaurante_id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= agora() - timedelta(days=28),
            ItemCardapio.ativo.is_(True),
            ItemCardapio.disponivel.is_(True),
        )
        .group_by(ItemCardapio.id, ItemCardapio.nome)
        .order_by(quantidade.desc(), ItemCardapio.nome)
        .limit(DESTAQUES)
    ).all()
    abertos = db.scalars(
        select(Alerta.tipo)
        .where(Alerta.mesa_id == mesa.id, Alerta.resolvido_em.is_(None))
        .distinct()
    ).all()
    visita = _visita_para_nota(db, mesa)
    sugeridos = {p.item_id for p in pratos_do_dia(db, plano_de_compras(db, restaurante, agora()))}
    return MesaPublicaSaida(
        restaurante=restaurante.nome,
        mesa=mesa.numero,
        com_clientes=mesa.estado in (Estado.AGUARDANDO, Estado.OCUPADA),
        chamados=[m for m, t in TIPO_DO_MOTIVO.items() if t.value in abertos],
        nota=visita.nota if visita else None,
        destaques=list(destaques),
        categorias=[
            CategoriaPublica(
                nome=c.nome,
                bebida=c.bebida,
                itens=[
                    ItemPublico(
                        nome=i.nome,
                        descricao=i.descricao,
                        preco_centavos=i.preco_centavos,
                        disponivel=i.disponivel,
                        sugestao=i.id in sugeridos,
                    )
                    for i in itens
                    if i.categoria_id == c.id
                ],
            )
            for c in categorias
        ],
    )


@router.post("/mesas/{chave}/chamar")
def chamar(
    chave: ChaveMesa, dados: ChamadoEntrada, request: Request, db: Db, servico: Servico
) -> RecadoSaida:
    mesa = _mesa(db, chave)
    if not request.app.state.limite_chamados.permitir(chave):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Já avisamos a equipe. Espere um instante."
        )
    try:
        novo = servico.chamar_pela_mesa(db, mesa, TIPO_DO_MOTIVO[dados.motivo], agora())
    except TransicaoInvalida as erro:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A mesa ainda aparece vazia para a equipe. Se acabou de sentar, espere um "
            "instante e tente de novo.",
        ) from erro
    conta = dados.motivo == "conta"
    if not novo:
        return RecadoSaida(texto="A equipe já foi avisada e está a caminho.")
    return RecadoSaida(
        texto="Pronto! A conta já vai até a mesa."
        if conta
        else "Pronto! Alguém da equipe já vem até a mesa."
    )


@router.post("/mesas/{chave}/avaliar")
def avaliar(chave: ChaveMesa, dados: NotaEntrada, db: Db) -> RecadoSaida:
    mesa = _mesa(db, chave)
    visita = _visita_para_nota(db, mesa)
    if visita is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Dá para avaliar enquanto estiver na mesa.")
    visita.nota, visita.nota_em = dados.nota, agora()  # vale a última nota da visita
    db.commit()
    return RecadoSaida(texto="Obrigado! Sua nota ajuda o restaurante a melhorar.")
