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
    # Dias em que o restaurante faz compra ("1,4" = terça e sexta; segunda = 0) e a folga da
    # lista de compras, em por cento.
    dias_compra: Mapped[str] = mapped_column(String(13), default="1,4", server_default="1,4")
    folga_compra_pct: Mapped[int] = mapped_column(default=15, server_default="15")
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
    # O garçom avisou que a mesa pediu a conta: o painel mostra quando ela deve vagar.
    conta_pedida_em: Mapped[datetime | None]


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


class CategoriaCardapio(Base):
    """Grupo do cardápio: Entradas, Massas, Bebidas..."""

    __tablename__ = "categorias_cardapio"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"), index=True)
    nome: Mapped[str] = mapped_column(String(60))
    ordem: Mapped[int] = mapped_column(default=0)
    # Bebida fica separada da comida nos resultados (prato da noite x bebida da noite).
    bebida: Mapped[bool] = mapped_column(default=False)
    ativa: Mapped[bool] = mapped_column(default=True)


class ItemCardapio(Base):
    """Um prato ou bebida. Nunca é apagado: sai do cardápio com `ativo=False`, para os
    relatórios antigos continuarem certos."""

    __tablename__ = "itens_cardapio"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"), index=True)
    categoria_id: Mapped[int] = mapped_column(ForeignKey("categorias_cardapio.id"))
    nome: Mapped[str] = mapped_column(String(80))
    descricao: Mapped[str | None] = mapped_column(String(200))
    preco_centavos: Mapped[int]
    # Quanto custa fazer o prato (opcional). Só o dono vê. Com ficha técnica, é a ficha que
    # calcula, e acompanha o preço das compras.
    custo_centavos: Mapped[int | None]
    # Tempero, óleo, guarnição pequena: entra no custo pela ficha, sem controle de estoque.
    custo_outros_centavos: Mapped[int | None]
    ativo: Mapped[bool] = mapped_column(default=True)
    # "Tem hoje": a cozinha marca que acabou e o garçom vê na hora.
    disponivel: Mapped[bool] = mapped_column(default=True)
    criado_em: Mapped[datetime] = mapped_column(default=agora)


class ItemPedido(Base):
    """Um item lançado numa mesa, preso à visita. Nome e preço são copiados na hora: mudar o
    cardápio depois não muda o que já foi pedido. Não guarda nada do cliente, só da mesa."""

    __tablename__ = "itens_pedido"
    __table_args__ = (
        Index("ix_itens_pedido_restaurante_lancado", "restaurante_id", "lancado_em"),
        Index("ix_itens_pedido_chave_lancamento", "restaurante_id", "chave_lancamento"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"))
    ocupacao_id: Mapped[int] = mapped_column(ForeignKey("ocupacoes.id"), index=True)
    mesa_id: Mapped[int] = mapped_column(ForeignKey("mesas.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("itens_cardapio.id"))
    nome: Mapped[str] = mapped_column(String(80))
    preco_unit_centavos: Mapped[int]
    quantidade: Mapped[int]
    observacao: Mapped[str | None] = mapped_column(String(80))  # "sem cebola"
    lancado_em: Mapped[datetime]
    lancado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    pronto_em: Mapped[datetime | None]
    cancelado_em: Mapped[datetime | None]
    cancelado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    motivo_cancelamento: Mapped[str | None] = mapped_column(String(60))
    # Chave que o aparelho inventa a cada "Lançar pedido". Sem internet o pedido fica na fila
    # do aparelho e é reenviado: com a mesma chave, o servidor não lança duas vezes.
    chave_lancamento: Mapped[str | None] = mapped_column(String(64))

    mesa: Mapped[Mesa] = relationship()


class Insumo(Base):
    """Ingrediente controlado no estoque: carne, queijo, massa, bebida. Quantidade na unidade
    base (grama, mililitro ou unidade) e preço por quilo, litro ou unidade. Nunca é apagado:
    sai com `ativo=False`, para o histórico continuar certo."""

    __tablename__ = "insumos"
    __table_args__ = (UniqueConstraint("restaurante_id", "nome"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"), index=True)
    nome: Mapped[str] = mapped_column(String(60))
    unidade: Mapped[str] = mapped_column(String(2))  # g, ml ou un
    # Como se compra: "pacote de 1 kg" = 1000 g. Arredonda a lista de compras.
    embalagem_quantidade: Mapped[int] = mapped_column(default=1)
    embalagem_nome: Mapped[str | None] = mapped_column(String(40))
    onde_compra: Mapped[str | None] = mapped_column(String(40))  # "Açougue", "Atacado"
    # Custo médio ponderado das compras, em centavos por kg, litro ou unidade.
    custo_centavos: Mapped[int | None]
    # Soma dos movimentos. Fica guardado para a tela não somar o livro todo a cada abertura.
    saldo: Mapped[int] = mapped_column(default=0, server_default="0")
    ativo: Mapped[bool] = mapped_column(default=True)
    criado_em: Mapped[datetime] = mapped_column(default=agora)


class FichaTecnica(Base):
    """Uma linha da receita de um prato: quanto de um ingrediente vai em uma porção."""

    __tablename__ = "fichas_tecnicas"
    __table_args__ = (UniqueConstraint("item_id", "insumo_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("itens_cardapio.id"), index=True)
    insumo_id: Mapped[int] = mapped_column(ForeignKey("insumos.id"))
    quantidade: Mapped[int]  # por porção, na unidade base do ingrediente

    insumo: Mapped[Insumo] = relationship()


class MovimentoEstoque(Base):
    """Uma linha do livro do estoque: compra, venda, estorno, perda ou contagem. O saldo do
    ingrediente é a soma delas. Nada se apaga: quem errou faz outro lançamento."""

    __tablename__ = "movimentos_estoque"
    __table_args__ = (Index("ix_movimentos_estoque_restaurante_em", "restaurante_id", "em"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"))
    insumo_id: Mapped[int] = mapped_column(ForeignKey("insumos.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(20))
    quantidade: Mapped[int]  # com sinal: entrada positiva, saída negativa
    saldo_depois: Mapped[int]
    valor_centavos: Mapped[int | None]  # valor da nota, nas compras
    # Venda e estorno de um prato apontam para o item do pedido.
    item_pedido_id: Mapped[int | None] = mapped_column(ForeignKey("itens_pedido.id"), index=True)
    motivo: Mapped[str | None] = mapped_column(String(30))  # perda: motivo da lista
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    em: Mapped[datetime]
