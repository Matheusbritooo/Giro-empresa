"""Copiloto GIRO: conversa com o dono sobre os números do salão.

Junta só números das últimas 4 semanas (por noite, por dia da semana, por hora e por mesa)
e com eles:
- escreve o briefing antes do turno, com regras fixas (funciona sem IA e sem internet);
- responde perguntas em português. Com GIRO_ANTHROPIC_API_KEY definido, quem responde é o
  Claude; sem a chave, respostas prontas para as perguntas mais comuns.

LGPD: para a IA vão só números agregados (turmas, minutos, reais, número da mesa). Nenhum
nome, e-mail, imagem ou dado de quem sentou na mesa.
"""

from __future__ import annotations

import json
import logging
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import anthropic
from sqlalchemy.orm import Session

from giro.config import Config
from giro.dominio.indicadores import FUSO, Indicadores, intervalo_da_noite, noite_de
from giro.modelos import Restaurante
from giro.servicos import resultados

log = logging.getLogger("giro.copiloto")

MODELO = "claude-opus-5-5"
DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
DIAS_PLURAL = ["segundas", "terças", "quartas", "quintas", "sextas", "sábados", "domingos"]

SISTEMA = """Você é o Copiloto GIRO, o gerente de bolso do dono de um restaurante de bairro.
O dono domina a cozinha, não a gestão. Ele quer saber o que fazer, não ver tabela.

Regras:
- Responda em português do Brasil, em até 5 frases curtas, sem termo técnico.
- Use só os números do JSON que acompanha a pergunta. Não invente número, mesa nem horário.
- Diga o número que importa e termine com uma ação concreta para o próximo turno.
- Dinheiro em reais (R$ 1.250), tempo em minutos, horário como 20h30.
- Os valores em reais são estimativas da GIRO: diga "cerca de".
- Se o JSON não tiver o dado para responder, diga isso e sugira onde olhar no painel
  (Resultados, Replay da noite ou "E se?").
- Não fale de pessoas específicas: o sistema só conta mesas e minutos."""


@dataclass
class Briefing:
    dia: date
    dia_semana: str
    frases: list[str]
    dicas: list[str]
    resumo_curto: str  # para a notificação no celular


@dataclass
class Contexto:
    """Os números que o Copiloto usa, já calculados."""

    restaurante: Restaurante
    hoje: date
    agora: datetime
    quatro_semanas: Indicadores
    noites: list[tuple[date, Indicadores]]  # as 28 noites, da mais antiga à de ontem
    hoje_ate_agora: Indicadores
    mesmo_dia: list[Indicadores] = field(default_factory=list)  # as 4 últimas iguais a hoje

    @property
    def dia_semana(self) -> int:
        return self.hoje.weekday()


def montar_contexto(db: Session, restaurante: Restaurante, agora: datetime) -> Contexto:
    hoje = noite_de(agora)
    inicio, _ = resultados.intervalo(resultados.Periodo.MES, hoje - timedelta(days=1))
    _, fim_hoje = intervalo_da_noite(hoje)
    dados = resultados.carregar(db, restaurante, inicio, fim_hoje, agora)
    inicio_hoje, _ = intervalo_da_noite(hoje)
    noites = []
    for i in range(28, 0, -1):
        dia = hoje - timedelta(days=i)
        de, ate = intervalo_da_noite(dia)
        noites.append((dia, dados.indicadores(de, ate)))
    return Contexto(
        restaurante=restaurante,
        hoje=hoje,
        agora=agora,
        quatro_semanas=dados.indicadores(inicio, inicio_hoje),
        noites=noites,
        hoje_ate_agora=dados.indicadores(inicio_hoje, min(fim_hoje, agora)),
        mesmo_dia=[r for d, r in noites if d.weekday() == hoje.weekday()],
    )


def _min(segundos: float | None) -> float | None:
    return round(segundos / 60, 1) if segundos is not None else None


def _minutos(segundos: float | None) -> str:
    """Minutos para o texto: "12,5 min"."""
    return f"{(segundos or 0) / 60:.1f}".replace(".", ",").removesuffix(",0") + " min"


def _reais(centavos: int) -> str:
    return f"R$ {centavos / 100:,.0f}".replace(",", ".")


def _mesas(n: float) -> str:
    """ "1 mesa", "3 mesas"."""
    return f"{n:.0f} {'mesa' if round(n) == 1 else 'mesas'}"


def _foram(n: float) -> str:
    return "foi" if round(n) == 1 else "foram"


def _hora(hora: int | None) -> str:
    return f"{hora}h" if hora is not None else "sem pico"


def _resumo(r: Indicadores) -> dict:
    return {
        "turmas_atendidas": r.mesas_atendidas,
        "pessoas_atendidas": r.pessoas_atendidas,
        "giro_por_mesa": round(r.giro_medio, 2),
        "espera_media_ate_atendimento_min": _min(r.espera_media_seg),
        "mesa_parada_media_min": _min(r.parada_media_seg),
        "foram_embora_sem_atendimento": r.desistencias,
        "perdido_estimado_reais": round(r.perdido_total_centavos / 100),
        "hora_pico": r.hora_pico,
    }


def contexto_em_json(ctx: Contexto) -> str:
    """O que a IA recebe: só números agregados."""
    r = ctx.restaurante
    por_dia: dict[str, list[Indicadores]] = {}
    for dia, ind in ctx.noites:
        if ind.noites:
            por_dia.setdefault(DIAS[dia.weekday()], []).append(ind)
    dados = {
        "restaurante": r.nome,
        "hoje": f"{ctx.hoje.isoformat()} ({DIAS[ctx.dia_semana]})",
        "agora": ctx.agora.astimezone(FUSO).strftime("%H:%M"),
        "horario_do_servico": f"{r.abre_as} às {r.fecha_as}",
        "ticket_medio_por_pessoa_reais": r.ticket_medio_centavos / 100,
        "alerta_sem_atendimento_min": r.alerta_atendimento_seg / 60,
        "ultimas_4_semanas": _resumo(ctx.quatro_semanas),
        "media_por_dia_da_semana": {
            dia: {
                "noites": len(lista),
                "turmas": round(sum(i.mesas_atendidas for i in lista) / len(lista), 1),
                "perdido_estimado_reais": round(
                    sum(i.perdido_total_centavos for i in lista) / len(lista) / 100
                ),
                "foram_embora_sem_atendimento": round(
                    sum(i.desistencias for i in lista) / len(lista), 1
                ),
            }
            for dia, lista in por_dia.items()
        },
        "noites": [
            {"dia": d.isoformat(), "dia_da_semana": DIAS[d.weekday()], **_resumo(i)}
            for d, i in ctx.noites
            if i.noites
        ],
        "mesas_ultimas_4_semanas": [
            {
                "mesa": m.numero,
                "lugares": m.lugares,
                "turmas": m.visitas,
                "espera_media_min": _min(m.espera_media_seg),
                "mesa_parada_media_min": _min(m.parada_media_seg),
                "foram_embora_sem_atendimento": m.desistencias,
                "perdido_estimado_reais": round(m.perdido_centavos / 100),
            }
            for m in ctx.quatro_semanas.por_mesa
        ],
        "por_hora_nas_ultimas_4_semanas": [
            {
                "hora": p.hora,
                "chegadas_por_noite": round(p.chegadas, 1),
                "ocupacao_pct": round(p.ocupacao * 100),
            }
            for p in ctx.quatro_semanas.por_hora
        ],
        "hoje_ate_agora": _resumo(ctx.hoje_ate_agora),
    }
    return json.dumps(dados, ensure_ascii=False)


def _media(valores: list[float]) -> float | None:
    return sum(valores) / len(valores) if valores else None


def briefing(ctx: Contexto) -> Briefing:
    """O recado antes do turno: o que costuma acontecer neste dia da semana e o que fazer."""
    dia, plural = DIAS[ctx.dia_semana], DIAS_PLURAL[ctx.dia_semana]
    com_movimento = [r for r in ctx.mesmo_dia if r.noites]
    if not com_movimento:
        return Briefing(
            ctx.hoje,
            dia,
            [f"Hoje é {dia}. Ainda não tenho {plural} anteriores para comparar."],
            ["Deixe a câmera ligada durante o serviço: amanhã já tenho o resumo da noite."],
            f"Hoje é {dia}. Bom serviço!",
        )

    turmas = _media([r.mesas_atendidas for r in com_movimento]) or 0
    picos = [r.hora_pico for r in com_movimento if r.hora_pico is not None]
    pico = max(set(picos), key=picos.count) if picos else None
    parada = _media([r.parada_media_seg for r in com_movimento if r.parada_media_seg]) or 0
    espera = _media([r.espera_media_seg for r in com_movimento if r.espera_media_seg]) or 0
    embora = _media([r.desistencias for r in com_movimento]) or 0
    perdido = _media([r.perdido_total_centavos for r in com_movimento]) or 0
    limite = ctx.restaurante.alerta_atendimento_seg

    frases = [
        f"Hoje é {dia}. Nas últimas {len(com_movimento)} {plural}, você atendeu em média "
        f"{turmas:.0f} mesas, e o salão encheu mais às {_hora(pico)}."
    ]
    dicas = []
    if parada > 5 * 60:
        frases.append(
            f"Quando enche, a mesa leva {parada / 60:.0f} min para ser liberada depois que o "
            "cliente sai."
        )
        if pico is not None:
            dicas.append(f"Deixe uma pessoa só para limpar mesas entre {pico - 1}h e {pico + 1}h.")
    pior = max(
        (m for m in ctx.quatro_semanas.por_mesa if m.parada_media_seg),
        key=lambda m: m.parada_media_seg or 0,
        default=None,
    )
    if pior and pior.parada_media_seg and pior.parada_media_seg > max(parada, 8 * 60):
        frases.append(
            f"A mesa {pior.numero} é a que mais fica parada: "
            f"{pior.parada_media_seg / 60:.0f} min em média."
        )
        dicas.append(f"Combine quem cuida da mesa {pior.numero} quando o salão encher.")
    if embora >= 1:
        frases.append(
            f"Em média, {_mesas(embora)} por {dia} {_foram(embora)} embora sem ninguém atender."
        )
        if pico is not None:
            dicas.append(f"Entre {pico}h e {pico + 1}h, atenda primeiro quem acabou de sentar.")
    elif espera > limite * 0.6:
        frases.append(f"A espera até o primeiro atendimento ficou em {espera / 60:.0f} min.")
    if perdido > 0:
        frases.append(
            f"Somando mesa parada e quem foi embora, cerca de {_reais(round(perdido))} "
            f"por {dia} ficaram na mesa."
        )
    if not dicas:
        dicas.append("O salão tem andado bem neste dia. Mantenha o ritmo.")

    curto = f"Hoje é {dia}: pico às {_hora(pico)}. {dicas[0]}"
    return Briefing(ctx.hoje, dia, frases, dicas, curto)


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn"
    )


def responder_com_regras(pergunta: str, ctx: Contexto) -> str:
    """Respostas prontas para as perguntas mais comuns, quando a IA não está ligada."""
    p = _sem_acento(pergunta)
    q = ctx.quatro_semanas
    if "mesa" in p and any(t in p for t in ("pior", "prejuizo", "mais", "custa", "parada")):
        pior = max(q.por_mesa, key=lambda m: m.perdido_centavos, default=None)
        if pior is None or pior.perdido_centavos == 0:
            return "Nas últimas 4 semanas nenhuma mesa deu prejuízo que dê para medir."
        return (
            f"A mesa {pior.numero} foi a que mais custou nas últimas 4 semanas: cerca de "
            f"{_reais(pior.perdido_centavos)}. Ela fica em média {_minutos(pior.parada_media_seg)} "
            "parada depois que o cliente sai. Combine quem libera essa mesa quando o salão encher."
        )
    if any(t in p for t in ("perdi", "perde", "dinheiro", "prejuizo", "custou", "quanto")):
        return (
            f"Nas últimas 4 semanas, cerca de {_reais(q.perdido_total_centavos)} ficaram na mesa: "
            f"{_reais(q.perdido_mesa_parada_centavos)} de mesa parada com o salão cheio e "
            f"{_reais(q.perdido_desistencias_centavos)} de {_mesas(q.desistencias)} que "
            f"{_foram(q.desistencias)} embora sem atendimento. "
            'Use o "E se?" para ver quanto volta limpando mais rápido.'
        )
    if any(t in p for t in ("pico", "horario", "hora", "cheio", "lota")):
        cheias = [h for h in q.por_hora if h.ocupacao >= 0.75]
        faixa = (
            f"das {cheias[0].hora}h às {cheias[-1].hora + 1}h"
            if cheias
            else f"perto das {_hora(q.hora_pico)}"
        )
        return (
            f"O salão costuma lotar {faixa}, com o maior número de chegadas às "
            f"{_hora(q.hora_pico)}. É aí que vale ter alguém só para limpar e liberar mesa."
        )
    if any(t in p for t in ("garcom", "garcons", "equipe", "funcionario", "contratar")):
        return (
            f"A espera média até o primeiro atendimento foi {_minutos(q.espera_media_seg)} e "
            f"{_mesas(q.desistencias)} {_foram(q.desistencias)} embora sem atendimento em 4 "
            "semanas. Abra o "
            '"E se?" em Resultados e mude o número de garçons: ele mostra quanto isso rende.'
        )
    if any(t in p for t in ("semana passada", "ontem", "compar", "pior que", "melhor que")):
        com_movimento = [(d, r) for d, r in ctx.noites if r.noites]
        if len(com_movimento) < 2:
            return "Ainda não tenho noites suficientes para comparar."
        dia, ultima = com_movimento[-1]
        semana_antes = [r for d, r in com_movimento if d == dia - timedelta(days=7)]
        antes = semana_antes[0] if semana_antes else com_movimento[-2][1]
        return (
            f"Na última noite ({DIAS[dia.weekday()]}) foram {ultima.mesas_atendidas} mesas "
            f"atendidas e cerca de {_reais(ultima.perdido_total_centavos)} perdidos. Na noite "
            f"de comparação foram {antes.mesas_atendidas} mesas e "
            f"{_reais(antes.perdido_total_centavos)}."
        )
    b = briefing(ctx)
    return " ".join(b.frases) + " " + b.dicas[0]


class Copiloto:
    """Responde com o Claude quando há chave; senão, com as regras."""

    def __init__(self, config: Config) -> None:
        self._cliente = (
            anthropic.Anthropic(api_key=config.anthropic_api_key, timeout=30.0, max_retries=1)
            if config.anthropic_api_key
            else None
        )

    @property
    def ia_ligada(self) -> bool:
        return self._cliente is not None

    def responder(self, pergunta: str, ctx: Contexto) -> tuple[str, str]:
        """Devolve (resposta, fonte), com fonte "ia" ou "regras"."""
        if self._cliente is not None:
            resposta = self._perguntar_ao_claude(pergunta, ctx)
            if resposta:
                return resposta, "ia"
        return responder_com_regras(pergunta, ctx), "regras"

    def _perguntar_ao_claude(self, pergunta: str, ctx: Contexto) -> str | None:
        assert self._cliente is not None
        try:
            resposta = self._cliente.beta.messages.create(
                model=MODELO,
                max_tokens=4000,
                system=SISTEMA,
                # Resposta curta sobre números prontos: esforço baixo responde rápido.
                output_config={"effort": "low"},
                # Se o modelo recusar, a própria API tenta outro antes de devolver.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                messages=[
                    {
                        "role": "user",
                        "content": "Números do restaurante (JSON):\n"
                        + contexto_em_json(ctx)
                        + "\n\nPergunta do dono: "
                        + pergunta,
                    }
                ],
            )
        except anthropic.RateLimitError:
            log.warning("copiloto: limite de uso da IA atingido, respondendo com as regras")
            return None
        except anthropic.APIStatusError as erro:
            log.warning("copiloto: a IA respondeu com erro %s", erro.status_code)
            return None
        except anthropic.APIConnectionError:
            log.warning("copiloto: sem conexão com a IA, respondendo com as regras")
            return None
        except anthropic.APIError:
            log.exception("copiloto: resposta inesperada da IA, respondendo com as regras")
            return None
        if resposta.stop_reason == "refusal":
            return None
        texto = "".join(b.text for b in resposta.content if b.type == "text").strip()
        return texto or None
