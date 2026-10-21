"""Máquina de estados de uma mesa.

Recebe observações (quantas pessoas sentadas e quantas em pé junto à mesa, a cada ~10s)
e decide o estado da mesa, gerando eventos e alertas. Não conhece banco, câmera nem API:
quem alimenta pode ser o simulador ou a visão computacional.

    LIVRE ─(gente sentada 20s)─► AGUARDANDO ─(alguém em pé junto à mesa)─► OCUPADA
      ▲                            │ passou de 5 min: alerta                   │
      │                            │ esvaziou sem atendimento ─► LIVRE    (vazia por 1 min)
      │                                                                        ▼
      └───(equipe libera, ou nova turma senta)──────────────────────────── PARA_LIMPAR
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any


class Estado(StrEnum):
    LIVRE = "livre"
    AGUARDANDO = "aguardando"
    OCUPADA = "ocupada"
    PARA_LIMPAR = "para_limpar"


class TipoEvento(StrEnum):
    SENTOU = "sentou"
    ATENDIDA = "atendida"
    SAIU = "saiu"
    SAIU_SEM_ATENDIMENTO = "saiu_sem_atendimento"
    LIBERADA = "liberada"
    ALERTA_SEM_ATENDIMENTO = "alerta_sem_atendimento"
    ALERTA_MESA_VAGA = "alerta_mesa_vaga"


class TransicaoInvalida(Exception):
    """Ação manual pedida num estado em que ela não faz sentido."""


@dataclass(frozen=True)
class Regras:
    # Tempo vendo gente sentada antes de confirmar a ocupação (evita quem só passou pela mesa).
    confirma_sentou: timedelta = timedelta(seconds=20)
    # Tempo vendo a mesa vazia antes de confirmar a saída (evita oclusão e ida ao banheiro).
    confirma_saiu: timedelta = timedelta(seconds=60)
    # Tempo sentado sem ninguém da equipe chegar até disparar o alerta ao gerente.
    alerta_sem_atendimento: timedelta = timedelta(minutes=5)


@dataclass(frozen=True)
class Observacao:
    em: datetime
    sentados: int
    em_pe: int = 0  # pessoas em pé junto à mesa (na prática, o garçom)


@dataclass(frozen=True)
class Evento:
    tipo: TipoEvento
    em: datetime
    pessoas: int | None = None


@dataclass
class MaquinaMesa:
    regras: Regras
    estado: Estado = Estado.LIVRE
    estado_desde: datetime | None = None
    sentou_em: datetime | None = None
    pessoas_max: int = 0
    alertou_sem_atendimento: bool = False
    # Primeira vez que viu gente sentada numa mesa livre ou suja (ocupação ainda não confirmada).
    candidato_desde: datetime | None = None
    # Primeira vez que viu a mesa vazia com clientes (saída ainda não confirmada).
    vazia_desde: datetime | None = None
    ultima_observacao: datetime | None = None

    def observar(self, obs: Observacao) -> list[Evento]:
        if self.ultima_observacao is not None and obs.em <= self.ultima_observacao:
            return []  # repetida ou fora de ordem
        self.ultima_observacao = obs.em

        if self.estado in (Estado.LIVRE, Estado.PARA_LIMPAR):
            eventos = self._observar_sem_clientes(obs)
        else:
            eventos = self._observar_com_clientes(obs)
        return eventos + self.verificar_tempo(obs.em)

    def verificar_tempo(self, agora: datetime) -> list[Evento]:
        """Dispara alertas que dependem só do relógio. Pode ser chamado sem observação nova."""
        if (
            self.estado == Estado.AGUARDANDO
            and not self.alertou_sem_atendimento
            and self.sentou_em is not None
            and agora - self.sentou_em >= self.regras.alerta_sem_atendimento
        ):
            self.alertou_sem_atendimento = True
            return [Evento(TipoEvento.ALERTA_SEM_ATENDIMENTO, agora)]
        return []

    def liberar(self, agora: datetime) -> list[Evento]:
        """A equipe marcou no celular que a mesa está limpa."""
        if self.estado != Estado.PARA_LIMPAR:
            raise TransicaoInvalida(f"mesa está {self.estado.value}, não precisa ser liberada")
        self._encerrar(agora)
        return [Evento(TipoEvento.LIBERADA, agora)]

    def _observar_sem_clientes(self, obs: Observacao) -> list[Evento]:
        if obs.sentados == 0:
            self.candidato_desde = None
            return []
        if self.candidato_desde is None:
            self.candidato_desde = obs.em
        if obs.em - self.candidato_desde < self.regras.confirma_sentou:
            return []

        sentou_em = self.candidato_desde
        eventos = []
        if self.estado == Estado.PARA_LIMPAR:
            # A equipe não marcou a limpeza, mas uma nova turma sentou: a mesa voltou a girar.
            eventos.append(Evento(TipoEvento.LIBERADA, sentou_em))
        self._mudar(Estado.AGUARDANDO, sentou_em)
        self.sentou_em = sentou_em
        self.pessoas_max = obs.sentados
        self.alertou_sem_atendimento = False
        self.candidato_desde = None
        self.vazia_desde = None
        eventos.append(Evento(TipoEvento.SENTOU, sentou_em, pessoas=obs.sentados))
        return eventos

    def _observar_com_clientes(self, obs: Observacao) -> list[Evento]:
        if obs.sentados > 0:
            self.vazia_desde = None
            self.pessoas_max = max(self.pessoas_max, obs.sentados)
            if self.estado == Estado.AGUARDANDO and obs.em_pe > 0:
                self._mudar(Estado.OCUPADA, obs.em)
                return [Evento(TipoEvento.ATENDIDA, obs.em)]
            return []

        if self.vazia_desde is None:
            self.vazia_desde = obs.em
        if obs.em - self.vazia_desde < self.regras.confirma_saiu:
            return []

        saiu_em = self.vazia_desde
        pessoas = self.pessoas_max
        if self.estado == Estado.AGUARDANDO:
            # Foi embora sem ser atendido. Mesa não foi usada, volta direto a livre.
            self._encerrar(saiu_em)
            return [Evento(TipoEvento.SAIU_SEM_ATENDIMENTO, saiu_em, pessoas=pessoas)]

        self._mudar(Estado.PARA_LIMPAR, saiu_em)
        self.vazia_desde = None
        return [
            Evento(TipoEvento.SAIU, saiu_em, pessoas=pessoas),
            Evento(TipoEvento.ALERTA_MESA_VAGA, obs.em),
        ]

    def _mudar(self, estado: Estado, em: datetime) -> None:
        self.estado = estado
        self.estado_desde = em

    def _encerrar(self, em: datetime) -> None:
        self._mudar(Estado.LIVRE, em)
        self.sentou_em = None
        self.pessoas_max = 0
        self.alertou_sem_atendimento = False
        self.candidato_desde = None
        self.vazia_desde = None

    # Persistência: o estado vai para uma coluna JSON da mesa e volta a cada observação.

    def para_dict(self) -> dict[str, Any]:
        def iso(d: datetime | None) -> str | None:
            return d.isoformat() if d else None

        return {
            "estado": self.estado.value,
            "estado_desde": iso(self.estado_desde),
            "sentou_em": iso(self.sentou_em),
            "pessoas_max": self.pessoas_max,
            "alertou_sem_atendimento": self.alertou_sem_atendimento,
            "candidato_desde": iso(self.candidato_desde),
            "vazia_desde": iso(self.vazia_desde),
            "ultima_observacao": iso(self.ultima_observacao),
        }

    @classmethod
    def de_dict(cls, regras: Regras, dados: dict[str, Any] | None) -> MaquinaMesa:
        if not dados:
            return cls(regras=regras)

        def data(chave: str) -> datetime | None:
            valor = dados.get(chave)
            return datetime.fromisoformat(valor) if valor else None

        return cls(
            regras=regras,
            estado=Estado(dados.get("estado", Estado.LIVRE)),
            estado_desde=data("estado_desde"),
            sentou_em=data("sentou_em"),
            pessoas_max=dados.get("pessoas_max", 0),
            alertou_sem_atendimento=dados.get("alertou_sem_atendimento", False),
            candidato_desde=data("candidato_desde"),
            vazia_desde=data("vazia_desde"),
            ultima_observacao=data("ultima_observacao"),
        )
