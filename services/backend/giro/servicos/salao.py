"""Liga a máquina de estados ao banco, aos alertas, ao painel ao vivo e ao celular."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.dominio.mesa import Estado, Evento, MaquinaMesa, Observacao, Regras, TipoEvento
from giro.esquemas import AlertaSaida, MesaSalao, ObservacaoMesa
from giro.modelos import (
    Alerta,
    Camera,
    EventoMesa,
    Mesa,
    Ocupacao,
    Papel,
    Restaurante,
    TipoAlerta,
)
from giro.push import EnviadorPush
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


def mesa_salao(mesa: Mesa, ocupacao: Ocupacao | None) -> MesaSalao:
    dados = MesaSalao(
        id=mesa.id,
        numero=mesa.numero,
        lugares=mesa.lugares,
        pos_x=mesa.pos_x,
        pos_y=mesa.pos_y,
        ativa=mesa.ativa,
        estado=mesa.estado,
        estado_desde=mesa.estado_desde,
    )
    if ocupacao is not None and mesa.estado != Estado.LIVRE:
        dados.sentou_em = ocupacao.sentou_em
        dados.atendida_em = ocupacao.atendida_em
        dados.saiu_em = ocupacao.saiu_em
        dados.pessoas = ocupacao.pessoas
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


class ServicoSalao:
    def __init__(self, central: CentralTempoReal, push: EnviadorPush) -> None:
        self.central = central
        self.push = push

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
        return sorted(numeros - mesas.keys())

    def liberar_mesa(self, db: Session, mesa: Mesa, agora: datetime) -> None:
        """Equipe tocou em "liberada". Pode lançar TransicaoInvalida."""
        restaurante = db.get_one(Restaurante, mesa.restaurante_id)
        maquina = MaquinaMesa.de_dict(regras_do_restaurante(restaurante), mesa.estado_maquina)
        eventos = maquina.liberar(agora)
        mudancas = _Mudancas()
        self._aplicar(db, mesa, maquina, eventos, mudancas)
        db.commit()
        self._avisar(db, restaurante.id, mudancas)

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
            ocupacoes = ocupacoes_abertas(db, list(mudancas.mesas))
            for mesa in mudancas.mesas.values():
                self.central.publicar(
                    restaurante_id,
                    {
                        "tipo": "mesa",
                        "mesa": mesa_salao(mesa, ocupacoes.get(mesa.id)).model_dump(mode="json"),
                    },
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
