"""Tabelas do banco.

Regra de ouro (LGPD e isolamento entre clientes):
- toda tabela de dado do cliente tem `restaurante_id`;
- nenhuma tabela guarda imagem. O que fica são eventos em texto ("mesa 4 ocupada às 20h41").
"""

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from giro.banco import Base, agora
from giro.dominio.mesa import Estado


class Papel(StrEnum):
    ADMIN_GIRO = "admin_giro"  # equipe da GIRO, vê todos os restaurantes
    DONO = "dono"
    GERENTE = "gerente"
    EQUIPE = "equipe"


class TipoAlerta(StrEnum):
    SEM_ATENDIMENTO = "sem_atendimento"
    MESA_VAGA = "mesa_vaga"


class Restaurante(Base):
    __tablename__ = "restaurantes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    cidade: Mapped[str | None] = mapped_column(String(80))
    alerta_atendimento_seg: Mapped[int] = mapped_column(default=300)
    # Gasto médio por pessoa, em centavos: transforma tempo perdido em dinheiro nos resultados.
    ticket_medio_centavos: Mapped[int] = mapped_column(default=8500, server_default="8500")
    # Horário do serviço, "HH:MM" em São Paulo: briefing na abertura, resumo no fechamento.
    abre_as: Mapped[str] = mapped_column(String(5), default="18:00", server_default="18:00")
    fecha_as: Mapped[str] = mapped_column(String(5), default="23:30", server_default="23:30")
    # Última noite (AAAA-MM-DD) que já recebeu o briefing e o resumo, para não mandar duas vezes.
    ultimo_briefing_noite: Mapped[str | None] = mapped_column(String(10))
    ultimo_resumo_noite: Mapped[str | None] = mapped_column(String(10))
    criado_em: Mapped[datetime] = mapped_column(default=agora)


class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int | None] = mapped_column(ForeignKey("restaurantes.id"), index=True)
    nome: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    senha_hash: Mapped[str] = mapped_column(String(255))
    papel: Mapped[str] = mapped_column(String(20))
    ativo: Mapped[bool] = mapped_column(default=True)
    criado_em: Mapped[datetime] = mapped_column(default=agora)

    restaurante: Mapped[Restaurante | None] = relationship()


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"), index=True)
    nome: Mapped[str] = mapped_column(String(80))
    # Só o hash do token fica no banco. O token aparece uma vez, na criação.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    ativa: Mapped[bool] = mapped_column(default=True)
    ultima_observacao_em: Mapped[datetime | None]
    # Calibração da visão desta câmera (giro/visao/leitura.py, classe Ajustes). Vazio = padrão.
    ajustes_visao: Mapped[dict[str, float] | None] = mapped_column(JSON(none_as_null=True))
    criado_em: Mapped[datetime] = mapped_column(default=agora)


class Mesa(Base):
    __tablename__ = "mesas"
    __table_args__ = (UniqueConstraint("restaurante_id", "numero"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"), index=True)
    camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id"))
    numero: Mapped[int]
    lugares: Mapped[int] = mapped_column(default=4)
    # Posição no mapa do painel (coluna e linha de uma grade).
    pos_x: Mapped[int] = mapped_column(default=0)
    pos_y: Mapped[int] = mapped_column(default=0)
    # Desenho da mesa sobre a imagem da câmera (Fase 2): lista de pontos [x, y] de 0 a 1.
    poligono: Mapped[list[list[float]] | None] = mapped_column(JSON(none_as_null=True))
    ativa: Mapped[bool] = mapped_column(default=True)

    estado: Mapped[str] = mapped_column(String(20), default=Estado.LIVRE.value)
    estado_desde: Mapped[datetime | None]
    estado_maquina: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class Ocupacao(Base):
    """Uma "visita" à mesa: sentou, foi atendida, saiu, foi liberada.

    É a base de todos os indicadores: giro, tempo até atendimento, tempo de mesa parada.
    """

    __tablename__ = "ocupacoes"
    __table_args__ = (Index("ix_ocupacoes_restaurante_sentou", "restaurante_id", "sentou_em"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"))
    mesa_id: Mapped[int] = mapped_column(ForeignKey("mesas.id"), index=True)
    sentou_em: Mapped[datetime]
    atendida_em: Mapped[datetime | None]
    saiu_em: Mapped[datetime | None]
    liberada_em: Mapped[datetime | None]
    pessoas: Mapped[int] = mapped_column(default=0)
    sem_atendimento: Mapped[bool] = mapped_column(default=False)  # foi embora sem ser atendido


class EventoMesa(Base):
    __tablename__ = "eventos_mesa"
    __table_args__ = (Index("ix_eventos_restaurante_em", "restaurante_id", "em"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"))
    mesa_id: Mapped[int] = mapped_column(ForeignKey("mesas.id"))
    ocupacao_id: Mapped[int | None] = mapped_column(ForeignKey("ocupacoes.id"))
    tipo: Mapped[str] = mapped_column(String(40))
    em: Mapped[datetime]
    criado_em: Mapped[datetime] = mapped_column(default=agora)


class Alerta(Base):
    __tablename__ = "alertas"
    __table_args__ = (Index("ix_alertas_restaurante_resolvido", "restaurante_id", "resolvido_em"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"))
    mesa_id: Mapped[int] = mapped_column(ForeignKey("mesas.id"))
    ocupacao_id: Mapped[int | None] = mapped_column(ForeignKey("ocupacoes.id"))
    tipo: Mapped[str] = mapped_column(String(30))
    criado_em: Mapped[datetime]
    reconhecido_em: Mapped[datetime | None]
    reconhecido_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    resolvido_em: Mapped[datetime | None]

    mesa: Mapped[Mesa] = relationship()


class InscricaoPush(Base):
    __tablename__ = "inscricoes_push"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    criado_em: Mapped[datetime] = mapped_column(default=agora)
