"""Liga a máquina de estados ao banco, aos alertas, ao painel ao vivo e ao celular."""

from __future__ import annotations

import functools
import threading
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Concatenate

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from giro.banco import agora
from giro.dominio.mesa import (
    Estado,
    Evento,
    MaquinaMesa,
    Observacao,
    Regras,
    TipoEvento,
    TransicaoInvalida,
)
from giro.esquemas import AlertaSaida, CameraSaida, MesaSalao, ObservacaoMesa
from giro.modelos import (
    Alerta,
    Camera,
    EventoMesa,
    ItemCardapio,
    ItemPedido,
    Mesa,
    Ocupacao,
    Papel,
    Restaurante,
    TipoAlerta,
)
from giro.push import EnviadorPush
from giro.servicos.cardapio import previsao_de_vaga
from giro.servicos.estoque import baixar_pedidos
from giro.tempo_real import CentralTempoReal

TIPO_ALERTA_DO_EVENTO = {
    TipoEvento.ALERTA_SEM_ATENDIMENTO: TipoAlerta.SEM_ATENDIMENTO,
    TipoEvento.ALERTA_MESA_VAGA: TipoAlerta.MESA_VAGA,
}


def regras_do_restaurante(restaurante: Restaurante) -> Regras:
    return Regras(alerta_sem_atendimento=timedelta(seconds=restaurante.alerta_atendimento_seg))


def ocupacoes_abertas(db: Session, mesa_ids: list[int]) -> dict[int, Ocupacao]:
    if not mesa_ids:
        return {}
    linhas = db.scalars(
        select(Ocupacao)
        .where(Ocupacao.mesa_id.in_(mesa_ids), Ocupacao.liberada_em.is_(None))
        .order_by(Ocupacao.sentou_em)
    )
    return {o.mesa_id: o for o in linhas}  # a mais recente vence


def lancamento_com_chave(db: Session, mesa: Mesa, chave: str | None) -> int | None:
    """A visita em que essa mesa já recebeu o lançamento com essa chave (None se é novo)."""
    if not chave:
        return None
    return db.scalar(
        select(ItemPedido.ocupacao_id)
        .where(
            ItemPedido.restaurante_id == mesa.restaurante_id,
            ItemPedido.chave_lancamento == chave,
            ItemPedido.mesa_id == mesa.id,
        )
        .limit(1)
    )


def totais_dos_pedidos(db: Session, ocupacao_ids: list[int]) -> dict[int, tuple[int, int]]:
    """Para cada visita: quanto já gastou e quantos itens ainda estão na cozinha."""
    if not ocupacao_ids:
        return {}
    na_cozinha = case((ItemPedido.pronto_em.is_(None), ItemPedido.quantidade), else_=0)
    linhas = db.execute(
        select(
            ItemPedido.ocupacao_id,
            func.sum(ItemPedido.quantidade * ItemPedido.preco_unit_centavos),
            func.sum(na_cozinha),
        )
        .where(ItemPedido.ocupacao_id.in_(ocupacao_ids), ItemPedido.cancelado_em.is_(None))
        .group_by(ItemPedido.ocupacao_id)
    )
    return {ocupacao: (int(total), int(cozinha)) for ocupacao, total, cozinha in linhas}


def mesas_salao(db: Session, mesas: list[Mesa]) -> list[MesaSalao]:
    """As mesas como aparecem no mapa, já com o pedido e a conta da visita em curso."""
    ocupacoes = ocupacoes_abertas(db, [m.id for m in mesas])
    totais = totais_dos_pedidos(db, [o.id for o in ocupacoes.values()])
    vaga_em = None
    if any(o.conta_pedida_em for o in ocupacoes.values()):
        vaga_em = timedelta(minutes=previsao_de_vaga(db, mesas[0].restaurante_id, agora()))
    return [mesa_salao(m, ocupacoes.get(m.id), totais, vaga_em) for m in mesas]


def mesa_salao(
    mesa: Mesa,
    ocupacao: Ocupacao | None,
    totais: dict[int, tuple[int, int]] | None = None,
    vaga_em: timedelta | None = None,
) -> MesaSalao:
    dados = MesaSalao(
        id=mesa.id,
        numero=mesa.numero,
        lugares=mesa.lugares,
        pos_x=mesa.pos_x,
        pos_y=mesa.pos_y,
        ativa=mesa.ativa,
        estado=mesa.estado,
        estado_desde=mesa.estado_desde,
        camera_id=mesa.camera_id,
        poligono=[tuple(p) for p in mesa.poligono] if mesa.poligono else None,
    )
    if ocupacao is not None and mesa.estado != Estado.LIVRE:
        dados.sentou_em = ocupacao.sentou_em
        dados.atendida_em = ocupacao.atendida_em
        dados.saiu_em = ocupacao.saiu_em
        dados.pessoas = ocupacao.pessoas
        total, cozinha = (totais or {}).get(ocupacao.id, (0, 0))
        dados.total_pedido_centavos, dados.itens_na_cozinha = total, cozinha
        if ocupacao.conta_pedida_em and mesa.estado == Estado.OCUPADA:
            dados.conta_pedida_em = ocupacao.conta_pedida_em
            if vaga_em is not None:
                dados.vaga_prevista_em = ocupacao.conta_pedida_em + vaga_em
    return dados


def alerta_saida(alerta: Alerta) -> AlertaSaida:
    return AlertaSaida(
        id=alerta.id,
        tipo=alerta.tipo,
        mesa_id=alerta.mesa_id,
        mesa_numero=alerta.mesa.numero,
        criado_em=alerta.criado_em,
        reconhecido_em=alerta.reconhecido_em,
        resolvido_em=alerta.resolvido_em,
    )


@dataclass
class _Mudancas:
    """O que mudou numa rodada, para avisar o painel e o celular depois de gravar."""

    mesas: dict[int, Mesa] = field(default_factory=dict)
    alertas_novos: list[Alerta] = field(default_factory=list)
    alertas_resolvidos: list[Alerta] = field(default_factory=list)


def _uma_por_vez[**P, R](
    metodo: Callable[Concatenate[ServicoSalao, P], R],
) -> Callable[Concatenate[ServicoSalao, P], R]:
    """
    A câmera, o botão "Liberar mesa" e o relógio mexem na mesma mesa em threads diferentes.
    No Postgres o `FOR UPDATE` faz um esperar o outro; no SQLite (desenvolvimento e testes)
    ele não trava nada, e a câmera e o relógio liam a mesa ao mesmo tempo e criavam o mesmo
    alerta duas vezes. Esta trava faz um esperar o outro dentro do processo.
    """

    @functools.wraps(metodo)
    def envolvido(self: ServicoSalao, *args: P.args, **kwargs: P.kwargs) -> R:
        with self._trava:
            return metodo(self, *args, **kwargs)

    return envolvido


class ServicoSalao:
    def __init__(self, central: CentralTempoReal, push: EnviadorPush) -> None:
        self.central = central
        self.push = push
        self._trava = threading.RLock()

    @_uma_por_vez
    def processar_observacoes(
        self, db: Session, camera: Camera, em: datetime, itens: list[ObservacaoMesa]
    ) -> list[int]:
        """Aplica uma foto já analisada. Devolve os números de mesa que não existem."""
        restaurante = db.get_one(Restaurante, camera.restaurante_id)
        regras = regras_do_restaurante(restaurante)
        numeros = {item.mesa for item in itens}
        mesas = {
            m.numero: m
            for m in db.scalars(
                select(Mesa)
                .where(
                    Mesa.restaurante_id == restaurante.id,
                    Mesa.numero.in_(numeros),
                    Mesa.ativa.is_(True),
                )
                .order_by(Mesa.id)
                .with_for_update()
            )
        }
        mudancas = _Mudancas()
        for item in itens:
            mesa = mesas.get(item.mesa)
            if mesa is None:
                continue
            maquina = MaquinaMesa.de_dict(regras, mesa.estado_maquina)
            eventos = maquina.observar(Observacao(em, item.sentados, item.em_pe))
            self._aplicar(db, mesa, maquina, eventos, mudancas)

        camera.ultima_observacao_em = em
        db.commit()
        self._avisar(db, restaurante.id, mudancas)
        # O painel mostra "câmera sem imagem" quando esta mensagem para de chegar.
        self.central.publicar(
            restaurante.id,
            {
                "tipo": "camera",
                "camera": CameraSaida.model_validate(camera).model_dump(mode="json"),
            },
        )
        return sorted(numeros - mesas.keys())

    @_uma_por_vez
    def liberar_mesa(self, db: Session, mesa: Mesa, agora: datetime) -> None:
        """Equipe tocou em "liberada". Pode lançar TransicaoInvalida."""
        restaurante = db.get_one(Restaurante, mesa.restaurante_id)
        maquina = MaquinaMesa.de_dict(regras_do_restaurante(restaurante), mesa.estado_maquina)
        eventos = maquina.liberar(agora)
        mudancas = _Mudancas()
        self._aplicar(db, mesa, maquina, eventos, mudancas)
        db.commit()
        self._avisar(db, restaurante.id, mudancas)

    @_uma_por_vez
    def registrar_pedido(
        self,
        db: Session,
        mesa: Mesa,
        linhas: list[tuple[ItemCardapio, int, str | None]],
        usuario_id: int | None,
        agora: datetime,
        chave: str | None = None,
    ) -> Ocupacao:
        """Garçom lançou itens na mesa. Conta como atendimento e, se a câmera ainda não
        confirmou ninguém, a visita começa aqui. Nome e preço vão copiados para o pedido.

        Com `chave`, lançar de novo o mesmo pedido (o aparelho reenviou porque a resposta se
        perdeu na rede) não muda nada: nem pedido em dobro, nem estoque baixado duas vezes."""
        if (ja_lancado := lancamento_com_chave(db, mesa, chave)) is not None:
            return db.get_one(Ocupacao, ja_lancado)
        restaurante = db.get_one(Restaurante, mesa.restaurante_id)
        maquina = MaquinaMesa.de_dict(regras_do_restaurante(restaurante), mesa.estado_maquina)
        mudancas = _Mudancas()
        self._aplicar(db, mesa, maquina, maquina.registrar_pedido(agora), mudancas)
        ocupacao = ocupacoes_abertas(db, [mesa.id])[mesa.id]
        pedidos = [
            ItemPedido(
                restaurante_id=mesa.restaurante_id,
                ocupacao_id=ocupacao.id,
                mesa_id=mesa.id,
                item_id=item.id,
                nome=item.nome,
                preco_unit_centavos=item.preco_centavos,
                quantidade=quantidade,
                observacao=observacao,
                lancado_em=agora,
                lancado_por_id=usuario_id,
                chave_lancamento=chave,
            )
            for item, quantidade, observacao in linhas
        ]
        db.add_all(pedidos)
        db.flush()  # os itens ganham id para o livro do estoque apontar para eles
        baixar_pedidos(db, pedidos, agora)
        mudancas.mesas[mesa.id] = mesa
        db.commit()
        self._avisar(db, restaurante.id, mudancas)
        self.central.publicar(restaurante.id, {"tipo": "pedido", "mesa_id": mesa.id})
        return ocupacao

    @_uma_por_vez
    def pedir_conta(self, db: Session, mesa: Mesa, pedida: bool, agora: datetime) -> None:
        """O garçom avisou que a mesa pediu a conta (ou desfez o toque sem querer)."""
        ocupacao = ocupacoes_abertas(db, [mesa.id]).get(mesa.id)
        if ocupacao is None or mesa.estado != Estado.OCUPADA:
            raise TransicaoInvalida("a mesa não está ocupada")
        ocupacao.conta_pedida_em = agora if pedida else None
        db.commit()
        self._avisar(db, mesa.restaurante_id, _Mudancas(mesas={mesa.id: mesa}))

    @_uma_por_vez
    def mexer_no_estoque[T](self, db: Session, restaurante_id: int, mudanca: Callable[[], T]) -> T:
        """Compra, perda, contagem e ficha esperam a vez dos pedidos (no SQLite não há
        FOR UPDATE) e avisam as telas abertas para buscar o estoque de novo."""
        resultado = mudanca()
        db.commit()
        self.central.publicar(restaurante_id, {"tipo": "estoque"})
        return resultado

    def avisar_pedido(self, db: Session, mesa: Mesa) -> None:
        """Um item ficou pronto ou foi cancelado: atualiza a mesa e a tela da cozinha."""
        self._avisar(db, mesa.restaurante_id, _Mudancas(mesas={mesa.id: mesa}))
        self.central.publicar(mesa.restaurante_id, {"tipo": "pedido", "mesa_id": mesa.id})

    @_uma_por_vez
    def verificar_tempos(self, db: Session, agora: datetime) -> None:
        """Alertas que dependem só do relógio (ex.: câmera parou de mandar foto)."""
        mesas = db.scalars(
            select(Mesa)
            .where(Mesa.estado == Estado.AGUARDANDO.value)
            .order_by(Mesa.id)
            .with_for_update()
        ).all()
        regras_por_restaurante: dict[int, Regras] = {}
        mudancas_por_restaurante: dict[int, _Mudancas] = defaultdict(_Mudancas)
        for mesa in mesas:
            if mesa.restaurante_id not in regras_por_restaurante:
                restaurante = db.get_one(Restaurante, mesa.restaurante_id)
                regras_por_restaurante[mesa.restaurante_id] = regras_do_restaurante(restaurante)
            maquina = MaquinaMesa.de_dict(
                regras_por_restaurante[mesa.restaurante_id], mesa.estado_maquina
            )
            eventos = maquina.verificar_tempo(agora)
            if eventos:
                self._aplicar(
                    db, mesa, maquina, eventos, mudancas_por_restaurante[mesa.restaurante_id]
                )
        db.commit()
        for restaurante_id, mudancas in mudancas_por_restaurante.items():
            self._avisar(db, restaurante_id, mudancas)

    def _aplicar(
        self,
        db: Session,
        mesa: Mesa,
        maquina: MaquinaMesa,
        eventos: list[Evento],
        mudancas: _Mudancas,
    ) -> None:
        mesa.estado_maquina = maquina.para_dict()
        if mesa.estado != maquina.estado.value or mesa.estado_desde != maquina.estado_desde:
            mesa.estado = maquina.estado.value
            mesa.estado_desde = maquina.estado_desde
            mudancas.mesas[mesa.id] = mesa
        if not eventos:
            return

        ocupacao = ocupacoes_abertas(db, [mesa.id]).get(mesa.id)
        for evento in eventos:
            match evento.tipo:
                case TipoEvento.SENTOU:
                    ocupacao = Ocupacao(
                        restaurante_id=mesa.restaurante_id,
                        mesa_id=mesa.id,
                        sentou_em=evento.em,
                        pessoas=evento.pessoas or 0,
                    )
                    db.add(ocupacao)
                    db.flush()
                case TipoEvento.ATENDIDA if ocupacao:
                    ocupacao.atendida_em = evento.em
                    self._resolver(db, mesa, TipoAlerta.SEM_ATENDIMENTO, evento.em, mudancas)
                case TipoEvento.SAIU if ocupacao:
                    ocupacao.saiu_em = evento.em
                    ocupacao.pessoas = evento.pessoas or ocupacao.pessoas
                case TipoEvento.SAIU_SEM_ATENDIMENTO if ocupacao:
                    ocupacao.saiu_em = ocupacao.liberada_em = evento.em
                    ocupacao.sem_atendimento = True
                    ocupacao.pessoas = evento.pessoas or ocupacao.pessoas
                    self._resolver(db, mesa, TipoAlerta.SEM_ATENDIMENTO, evento.em, mudancas)
                case TipoEvento.LIBERADA if ocupacao:
                    ocupacao.liberada_em = evento.em
                    self._resolver(db, mesa, TipoAlerta.MESA_VAGA, evento.em, mudancas)
                case TipoEvento.ALERTA_SEM_ATENDIMENTO | TipoEvento.ALERTA_MESA_VAGA:
                    alerta = Alerta(
                        restaurante_id=mesa.restaurante_id,
                        mesa_id=mesa.id,
                        mesa=mesa,
                        ocupacao_id=ocupacao.id if ocupacao else None,
                        tipo=TIPO_ALERTA_DO_EVENTO[evento.tipo].value,
                        criado_em=evento.em,
                    )
                    db.add(alerta)
                    mudancas.alertas_novos.append(alerta)

            db.add(
                EventoMesa(
                    restaurante_id=mesa.restaurante_id,
                    mesa_id=mesa.id,
                    ocupacao_id=ocupacao.id if ocupacao else None,
                    tipo=evento.tipo.value,
                    em=evento.em,
                )
            )
            if evento.tipo in (TipoEvento.LIBERADA, TipoEvento.SAIU_SEM_ATENDIMENTO):
                ocupacao = None
        mudancas.mesas[mesa.id] = mesa
        db.flush()

    def _resolver(
        self, db: Session, mesa: Mesa, tipo: TipoAlerta, em: datetime, mudancas: _Mudancas
    ) -> None:
        abertos = db.scalars(
            select(Alerta).where(
                Alerta.mesa_id == mesa.id,
                Alerta.tipo == tipo.value,
                Alerta.resolvido_em.is_(None),
            )
        ).all()
        abertos += [
            a for a in mudancas.alertas_novos if a.mesa_id == mesa.id and a.tipo == tipo.value
        ]
        for alerta in abertos:
            if alerta.resolvido_em is None:
                alerta.resolvido_em = em
                mudancas.alertas_resolvidos.append(alerta)

    def _avisar(self, db: Session, restaurante_id: int, mudancas: _Mudancas) -> None:
        if mudancas.mesas:
            for mesa in mesas_salao(db, list(mudancas.mesas.values())):
                self.central.publicar(
                    restaurante_id, {"tipo": "mesa", "mesa": mesa.model_dump(mode="json")}
                )
        resolvidos_agora = {a.id for a in mudancas.alertas_resolvidos}
        for alerta in mudancas.alertas_novos:
            if alerta.id in resolvidos_agora:
                continue  # nasceu e morreu na mesma rodada, não incomoda ninguém
            self.central.publicar(
                restaurante_id,
                {"tipo": "alerta", "alerta": alerta_saida(alerta).model_dump(mode="json")},
            )
            self._avisar_celular(restaurante_id, alerta)
        for alerta in mudancas.alertas_resolvidos:
            self.central.publicar(
                restaurante_id,
                {"tipo": "alerta", "alerta": alerta_saida(alerta).model_dump(mode="json")},
            )

    def _avisar_celular(self, restaurante_id: int, alerta: Alerta) -> None:
        numero = alerta.mesa.numero
        if alerta.tipo == TipoAlerta.SEM_ATENDIMENTO:
            self.push.enviar(
                restaurante_id,
                f"Mesa {numero} sem atendimento",
                "Cliente esperando e ninguém da equipe foi até a mesa ainda.",
                papeis=(Papel.DONO, Papel.GERENTE),
            )
        else:
            self.push.enviar(
                restaurante_id,
                f"Mesa {numero} vagou",
                "Os clientes saíram. Limpe e libere a mesa para a próxima turma.",
                papeis=(Papel.DONO, Papel.GERENTE, Papel.EQUIPE),
            )
