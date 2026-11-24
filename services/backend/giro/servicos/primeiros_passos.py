"""Primeiros passos: o que um restaurante novo precisa deixar pronto para o GIRO trabalhar,
na ordem em que faz sentido. Cada passo sabe se já está feito olhando o banco (ninguém marca
à mão) e leva para a tela onde se faz. Some da tela "Hoje" quando tudo está pronto.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from giro.modelos import (
    Atividade,
    Camera,
    FichaTecnica,
    ItemCardapio,
    Mesa,
    Ocupacao,
    Papel,
    Restaurante,
    Usuario,
)
from giro.servicos.atividades import GrupoAtividade

SO_DONO = (Papel.DONO, Papel.ADMIN_GIRO)
NOVO_ATE = timedelta(days=14)  # com visitas mais antigas que isso, o restaurante já roda


def restaurante_novo(db: Session, restaurante_id: int, agora: datetime) -> bool:
    """Ainda está começando: nenhuma visita registrada há mais de 14 dias. Quem já roda há
    semanas não precisa da lista na tela Hoje (os passos continuam valendo, só não aparecem)."""
    primeira = db.scalar(
        select(func.min(Ocupacao.sentou_em)).where(Ocupacao.restaurante_id == restaurante_id)
    )
    return primeira is None or primeira > agora - NOVO_ATE


@dataclass
class Passo:
    id: str
    titulo: str
    porque: str  # uma frase: o que o GIRO faz com isso
    feito: bool
    href: str
    so_dono: bool = False


def _conta(db: Session, consulta) -> int:
    return int(db.scalar(consulta) or 0)


def primeiros_passos(db: Session, restaurante: Restaurante) -> list[Passo]:
    rid = restaurante.id
    mesas = db.execute(
        select(Mesa.camera_id, Mesa.poligono, Mesa.chave_publica).where(
            Mesa.restaurante_id == rid, Mesa.ativa.is_(True)
        )
    ).all()
    camera_ligada = _conta(
        db,
        select(func.count(Camera.id)).where(
            Camera.restaurante_id == rid,
            Camera.ativa.is_(True),
            Camera.ultima_observacao_em.is_not(None),
        ),
    )
    itens = _conta(
        db,
        select(func.count(ItemCardapio.id)).where(
            ItemCardapio.restaurante_id == rid, ItemCardapio.ativo.is_(True)
        ),
    )
    equipe = _conta(
        db,
        select(func.count(Usuario.id)).where(
            Usuario.restaurante_id == rid,
            Usuario.ativo.is_(True),
            Usuario.papel.in_([Papel.GERENTE.value, Papel.EQUIPE.value]),
        ),
    )
    fichas = _conta(
        db, select(func.count(FichaTecnica.id)).where(FichaTecnica.restaurante_id == rid)
    )
    ajustes = _conta(
        db,
        select(func.count(Atividade.id)).where(
            Atividade.restaurante_id == rid, Atividade.grupo == GrupoAtividade.AJUSTES.value
        ),
    )
    return [
        Passo(
            "mesas",
            "Cadastre as mesas do salão",
            "Com o número e os lugares de cada uma, o salão aparece no mapa.",
            bool(mesas),
            "/mesas",
        ),
        Passo(
            "camera",
            "Ligue a câmera",
            "Cadastre a câmera e ligue o conector no gravador: a foto começa a chegar.",
            camera_ligada > 0,
            "/cameras",
            so_dono=True,
        ),
        Passo(
            "desenho",
            "Desenhe cada mesa na foto da câmera",
            "É assim que o GIRO sabe quem está sentado em qual mesa.",
            bool(mesas) and all(c is not None and p for c, p, _ in mesas),
            "/cameras",
        ),
        Passo(
            "cardapio",
            "Monte o cardápio com os preços",
            "O garçom lança o pedido em 3 toques e a cozinha recebe na hora.",
            itens > 0,
            "/cardapio",
        ),
        Passo(
            "equipe",
            "Dê acesso ao gerente e aos garçons",
            "Cada um entra com o próprio e-mail e vê só o que precisa.",
            equipe > 0,
            "/equipe",
            so_dono=True,
        ),
        Passo(
            "ajustes",
            "Confira o gasto por pessoa e o horário",
            "É com eles que o GIRO conta o dinheiro que ficou na mesa e avisa antes do turno.",
            ajustes > 0
            or restaurante.ticket_medio_centavos != 8500
            or (restaurante.abre_as, restaurante.fecha_as) != ("18:00", "23:30"),
            "/ajustes",
            so_dono=True,
        ),
        Passo(
            "fichas",
            "Cadastre os ingredientes e a ficha dos pratos",
            "O estoque baixa sozinho e a lista de compras sai pronta. Comece pelos que pesam.",
            fichas > 0,
            "/estoque?aba=fichas",
        ),
        Passo(
            "qr",
            "Imprima o QR de cada mesa",
            "O cliente chama o garçom, pede a conta e dá nota pelo celular, sem baixar nada.",
            bool(mesas) and all(chave for _, _, chave in mesas),
            "/mesas/qr",
        ),
    ]
