"""Copiloto GIRO: conversa com o dono sobre os números do salão.

Junta só números das últimas 4 semanas (por noite, por dia da semana, por hora e por mesa)
e com eles:
- escreve o briefing antes do turno, com regras fixas (funciona sem IA e sem internet);
- responde perguntas em português. Com GIRO_ANTHROPIC_API_KEY definido, quem responde é o
  Claude; sem a chave, respostas prontas para as perguntas mais comuns.

LGPD: para a IA vão só números agregados (turmas, minutos, reais, número da mesa, quantas
vezes cada prato saiu). Nenhum nome, e-mail, imagem ou dado de quem sentou na mesa. A matriz
de lucro dos pratos só vai quando quem pergunta é o dono (o único que vê custo). Do estoque
vão só quantidades (quanto tem, quando acaba, quanto comprar), nunca o valor em reais.
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
from giro.dominio.compras import Situacao, texto_compra, texto_quantidade
from giro.dominio.indicadores import FUSO, Indicadores, intervalo_da_noite, noite_de
from giro.modelos import Restaurante
from giro.servicos import resultados
from giro.servicos.cardapio import ResultadosCardapio, resultados_cardapio
from giro.servicos.compras import PlanoDeCompras, plano_de_compras
from giro.servicos.perdas import RelatorioDePerdas, contagem_atrasada, relatorio_de_perdas

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
- Não fale de pessoas específicas: o sistema só conta mesas e minutos.
- Sobre o cardápio, a matriz de lucro diz o que fazer: estrela, manter e destacar; burro de
  carga (vende muito, lucra pouco), subir um pouco o preço ou baratear a receita;
  quebra-cabeça (lucra bem, pouca gente pede), o garçom indicar; cão (vende pouco e lucra
  pouco), pensar em tirar. Sem a matriz no JSON, diga que custo e lucro só o dono vê."""

QUADRANTES = {
    "estrela": "estrela",
    "burro_de_carga": "burro de carga",
    "quebra_cabeca": "quebra-cabeça",
    "cao": "cão",
}


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
    # O que saiu da cozinha nas 4 semanas (None sem pedidos lançados). A matriz de lucro só
    # vem preenchida para quem vê custo.
    cardapio: ResultadosCardapio | None = None
    # Previsão e lista de compras (None sem ingrediente com ficha).
    compras: PlanoDeCompras | None = None
    # O estoque como está, mesmo sem previsão (None sem ingrediente cadastrado).
    plano: PlanoDeCompras | None = None
    # Perdas dos últimos 7 dias e os ingredientes da curva A sem contagem há uma semana.
    perdas: RelatorioDePerdas | None = None
    contar: list[str] = field(default_factory=list)
    com_custo: bool = False  # quem pergunta vê custo (o dono)

    @property
    def dia_semana(self) -> int:
        return self.hoje.weekday()


def montar_contexto(
    db: Session, restaurante: Restaurante, agora: datetime, com_custo: bool = False
) -> Contexto:
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
    cardapio = resultados_cardapio(
        db, restaurante, resultados.Periodo.MES, hoje - timedelta(days=1), agora, com_custo
    )
    compras = plano_de_compras(db, restaurante, agora)
    com_previsao = any(i.pratos for i in compras.itens)
    tem_estoque = bool(compras.itens)  # algum ingrediente cadastrado
    perdas = relatorio_de_perdas(db, restaurante, resultados.Periodo.SEMANA, agora)
    contar = (
        [i.nome for i in contagem_atrasada(db, restaurante.id, agora, perdas.curva)]
        if tem_estoque
        else []
    )
    return Contexto(
        restaurante=restaurante,
        hoje=hoje,
        agora=agora,
        quatro_semanas=dados.indicadores(inicio, inicio_hoje),
        noites=noites,
        hoje_ate_agora=dados.indicadores(inicio_hoje, min(fim_hoje, agora)),
        mesmo_dia=[r for d, r in noites if d.weekday() == hoje.weekday()],
        cardapio=cardapio if cardapio.visitas_com_pedido else None,
        compras=compras if com_previsao else None,
        plano=compras if tem_estoque else None,
        perdas=perdas if tem_estoque else None,
        contar=contar,
        com_custo=com_custo,
    )


def _min(segundos: float | None) -> float | None:
    return round(segundos / 60, 1) if segundos is not None else None


def _minutos(segundos: float | None) -> str:
    """Minutos para o texto: "12,5 min"."""
    return f"{(segundos or 0) / 60:.1f}".replace(".", ",").removesuffix(",0") + " min"


def em_reais(centavos: int) -> str:
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
    if ctx.cardapio is not None:
        dados["cardapio_ultimas_4_semanas"] = _cardapio_em_numeros(ctx.cardapio)
    if ctx.compras is not None:
        dados["estoque"] = _estoque_em_numeros(ctx.compras)
    if ctx.perdas is not None:
        dados["perdas_do_estoque_7_dias"] = _perdas_em_numeros(ctx.perdas, ctx.contar)
    return json.dumps(dados, ensure_ascii=False)


def _perdas_em_numeros(r: RelatorioDePerdas, contar: list[str]) -> dict:
    """Só quantidades: o que escapou de cada ingrediente e o que não foi contado. Nunca
    reais, nem a porcentagem do custo."""
    return {
        "contado_no_periodo": r.ultima_contagem is not None,
        "ingredientes": [
            {
                "nome": linha.insumo.nome,
                "escapou": texto_quantidade(linha.insumo.unidade, linha.perda.escapou),
                "sem_registro": texto_quantidade(linha.insumo.unidade, linha.perda.sem_registro),
                "perda_registrada": texto_quantidade(linha.insumo.unidade, linha.perda.registrada),
            }
            for linha in r.linhas[:8]
        ],
        "curva_a_sem_contagem_ha_uma_semana": contar,
    }


def quando_acaba(noite: date, hoje: date) -> str:
    """ "hoje", "amanhã", "na quinta", "no sábado"."""
    if noite == hoje:
        return "hoje"
    if noite == hoje + timedelta(days=1):
        return "amanhã"
    dia = DIAS[noite.weekday()]
    return f"{'no' if noite.weekday() >= 5 else 'na'} {dia}"


def _texto_do_item(item) -> str:
    i = item.insumo
    return texto_compra(i.unidade, item.linha.embalagens, i.embalagem_quantidade, i.embalagem_nome)


def _estoque_em_numeros(plano: PlanoDeCompras) -> dict:
    """Só quantidades: quanto tem, quando acaba e quanto comprar. Nunca reais."""
    return {
        "proxima_compra": (
            f"{DIAS[plano.compra.weekday()]} ({quando_acaba(plano.compra, plano.hoje)})"
        ),
        "noites_que_a_compra_cobre": [DIAS[n.weekday()] for n in plano.cobre],
        "folga_pct": plano.folga_pct,
        "ingredientes": [
            {
                "nome": item.insumo.nome,
                "tem": texto_quantidade(item.insumo.unidade, item.insumo.saldo),
                "acaba": quando_acaba(item.acaba_em, plano.hoje) if item.acaba_em else None,
                "comprar": _texto_do_item(item) if item.linha.embalagens else None,
            }
            for item in plano.itens
        ],
    }


def acabam_antes_da_compra(plano: PlanoDeCompras) -> list:
    return [
        i
        for i in plano.itens
        if i.acaba_em is not None and (i.acaba_em < plano.compra or i.acaba_em == plano.hoje)
    ]


def _cardapio_em_numeros(c: ResultadosCardapio) -> dict:
    """Só contagens e reais somados: o que saiu, o que combina, quanto a cozinha leva."""
    numeros: dict = {
        "mais_pedidos": [
            {
                "item": i.nome,
                "categoria": i.categoria,
                "bebida": i.bebida,
                "quantidade": i.quantidade,
                "vendido_reais": round(i.receita_centavos / 100),
            }
            for i in c.itens[:12]
        ],
        "ticket_real_por_pessoa_reais": (
            round(c.ticket_real_centavos / 100) if c.ticket_real_centavos else None
        ),
        "quem_pede_tambem_pede": [
            {"prato": cb.item, "acompanha": [f"{a.nome} ({a.percentual}%)" for a in cb.acompanha]}
            for cb in c.combinacoes
        ],
        "tempo_de_cozinha_min": [
            {
                "item": t.nome,
                "minutos": t.tempo.minutos,
                "sexta_e_sabado": t.tempo.minutos_fim_de_semana,
                "outros_dias": t.tempo.minutos_semana,
            }
            for t in c.tempos[:6]
        ],
    }
    if c.matrizes is not None:
        numeros["matriz_de_lucro"] = {
            m.categoria: {
                QUADRANTES[q]: [i.nome for i in m.matriz.itens if i.quadrante == q]
                for q in QUADRANTES
            }
            for m in c.matrizes
        }
    return numeros


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
            f"Somando mesa parada e quem foi embora, cerca de {em_reais(round(perdido))} "
            f"por {dia} ficaram na mesa."
        )
    if not dicas:
        dicas.append("O salão tem andado bem neste dia. Mantenha o ritmo.")
    if ctx.compras is not None:
        plano = ctx.compras
        urgentes = acabam_antes_da_compra(plano)
        if urgentes:
            nomes = ", ".join(
                f"{i.insumo.nome.lower()} ({quando_acaba(i.acaba_em, plano.hoje)})"
                for i in urgentes
            )
            # Acabar hoje é o que o dono precisa ler primeiro, até na notificação.
            dica = (
                f"Pela conta do estoque, acaba antes da compra de {DIAS[plano.compra.weekday()]}: "
                f"{nomes}. Confira a geladeira e, se faltar, marque o prato como acabou."
            )
            if any(i.acaba_em == plano.hoje for i in urgentes):
                dicas.insert(0, dica)
            else:
                dicas.append(dica)
        elif plano.compra == plano.hoje:
            itens = sum(1 for i in plano.itens if i.linha.embalagens)
            if itens:
                dicas.append(
                    f"Hoje é dia de compra: {itens} "
                    f"{'item' if itens == 1 else 'itens'} na lista, em Estoque."
                )
    elif ctx.cardapio is not None:
        prato = next((i for i in ctx.cardapio.itens if not i.bebida), None)
        if prato is not None:
            dicas.append(f"Confira o estoque para {prato.nome}: é o que mais sai da cozinha.")
    if ctx.contar:
        nomes = ", ".join(n.lower() for n in ctx.contar[:3])
        resto = f" e mais {len(ctx.contar) - 3}" if len(ctx.contar) > 3 else ""
        dicas.append(
            f"Faz mais de uma semana sem contar {nomes}{resto}, da curva A. Uns 10 minutos de "
            "contagem mostram onde o dinheiro escapa."
        )

    curto = f"Hoje é {dia}: pico às {_hora(pico)}. {dicas[0]}"
    return Briefing(ctx.hoje, dia, frases, dicas, curto)


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn"
    )


def responder_sobre_cardapio(p: str, ctx: Contexto) -> str | None:
    """Perguntas sobre pratos e cozinha. None quando a pergunta não é sobre o cardápio."""
    sobre_pratos = any(t in p for t in ("prato", "cardapio", "comida", "bebida", "cozinha"))
    tirar = any(
        t in p
        for t in ("tirar", "tiro", "tira ", "cortar", "corto", "lucra", "lucro", "prejuizo",
                  "margem", "sair do cardapio")
    )  # fmt: skip
    mais = any(t in p for t in ("mais pedido", "mais sai", "mais vende", "favorit", "campe"))
    demora = any(t in p for t in ("demora", "tempo de cozinha", "preparo", "lento"))
    combina = any(t in p for t in ("combina", "oferecer", "sugerir", "acompanha"))
    if not (sobre_pratos or demora or combina):
        return None
    c = ctx.cardapio
    if c is None:
        return (
            "Ainda não tenho pedidos lançados para falar do cardápio. Quando o garçom lançar "
            "os pedidos na mesa, eu mostro o que mais sai e o que lucra pouco."
        )
    if sobre_pratos and tirar:
        if c.matrizes is None:
            return (
                "Custo e lucro dos pratos só o dono vê. Peça ao dono para perguntar, ou veja "
                "os mais pedidos em Resultados."
            )
        caes = [(m.categoria, i.nome) for m in c.matrizes for i in m.matriz.itens
                if i.quadrante == "cao"]  # fmt: skip
        burros = [i.nome for m in c.matrizes for i in m.matriz.itens
                  if i.quadrante == "burro_de_carga"]  # fmt: skip
        partes = []
        if caes:
            nomes = ", ".join(f"{n} ({cat})" for cat, n in caes)
            partes.append(
                f"Vendem pouco e lucram pouco nas últimas 4 semanas: {nomes}. São os candidatos"
                " a sair do cardápio; antes, peça ao garçom para oferecer por uma semana."
            )
        else:
            partes.append("Nenhum prato vende pouco e lucra pouco ao mesmo tempo.")
        if burros:
            partes.append(
                f"{', '.join(burros)} vendem muito mas lucram pouco: vale subir um pouco o "
                "preço ou baratear a receita."
            )
        return " ".join(partes)
    if demora:
        if not c.tempos:
            return "Ainda não tenho pratos marcados como prontos para medir a cozinha."
        t = c.tempos[0]
        extra = ""
        if t.tempo.minutos_fim_de_semana and t.tempo.minutos_semana:
            extra = (
                f" Na sexta e no sábado leva {t.tempo.minutos_fim_de_semana:.0f} min; nos "
                f"outros dias, {t.tempo.minutos_semana:.0f}."
            )
        return (
            f"O prato que mais demora é {t.nome}: {t.tempo.minutos:.0f} min do pedido até "
            f"ficar pronto.{extra} Deixe a massa adiantada antes do pico."
        )
    if combina:
        if not c.combinacoes:
            return "Ainda não tenho pedidos suficientes para dizer o que combina com o quê."
        cb = c.combinacoes[0]
        lista = ", ".join(f"{a.nome} ({a.percentual}%)" for a in cb.acompanha)
        return (
            f"Quem pede {cb.item} também costuma pedir: {lista}. Peça ao garçom para "
            "oferecer junto."
        )
    if sobre_pratos and (mais or "qual" in p):
        prato = next((i for i in c.itens if not i.bebida), None)
        bebida = next((i for i in c.itens if i.bebida), None)
        frases = []
        if prato:
            frases.append(
                f"O prato que mais sai é {prato.nome}: {prato.quantidade} pedidos nas últimas "
                f"4 semanas, cerca de {em_reais(prato.receita_centavos)}."
            )
        if bebida:
            frases.append(f"A bebida que mais sai é {bebida.nome} ({bebida.quantidade}).")
        frases.append("Confira o estoque para ele antes do pico.")
        return " ".join(frases)
    return None


def _pct(fracao: float) -> str:
    return f"{fracao * 100:.1f}%".replace(".", ",")


def responder_sobre_perdas(p: str, ctx: Contexto) -> str | None:
    """Onde o estoque perde dinheiro. Em reais só para o dono; o gerente ouve quantidades."""
    sobre_perdas = any(
        t in p for t in ("desperdic", "sumiu", "sumindo", "escapou", "escapa", "desvio")
    ) or ("perd" in p and "estoque" in p)
    if not sobre_perdas:
        return None
    r = ctx.perdas
    if r is None:
        return (
            "Ainda não tenho estoque para olhar. Cadastre os ingredientes e a ficha dos pratos "
            "em Estoque e conte o estoque uma vez por semana."
        )
    sem_contagem = (
        "Ninguém contou o estoque nos últimos 7 dias: sem contagem, só aparece o que foi "
        "registrado como perda. "
        if r.ultima_contagem is None
        else ""
    )
    if not r.linhas:
        return sem_contagem + "Nos últimos 7 dias nada escapou do estoque pela conta."
    principais = r.linhas[:3]
    if not ctx.com_custo:
        nomes = ", ".join(
            f"{linha.insumo.nome.lower()} "
            f"{texto_quantidade(linha.insumo.unidade, linha.perda.escapou)}"
            for linha in principais
        )
        return (
            f"{sem_contagem}Perdas em reais ficam com o dono. Em quantidade, nos últimos 7 dias "
            f"escaparam: {nomes}."
        )
    vendeu = r.vendeu_centavos or 1
    nomes = ", ".join(
        f"{linha.insumo.nome.lower()} ({em_reais(linha.valor_escapou or 0)})"
        for linha in principais
    )
    maior = (
        "A maior parte não foi registrada: confira a porção e se a contagem está certa."
        if r.sem_registro_centavos > r.registrada_centavos
        else "A maior parte foi registrada como perda: veja os motivos em Estoque, Perdas."
    )
    return (
        f"{sem_contagem}Nos últimos 7 dias escaparam {em_reais(r.escapou_centavos)} do estoque. "
        f"Pela ficha, os ingredientes custaram {_pct(r.custo_pela_ficha_centavos / vendeu)} "
        f"do que vendeu; de verdade, {_pct(r.custo_de_verdade_centavos / vendeu)}. "
        f"Os que mais pesaram: {nomes}. {maior}"
    )


def responder_sobre_estoque(p: str, ctx: Contexto) -> str | None:
    """O que comprar e o que está acabando. None quando a pergunta não é sobre isso."""
    comprar = any(t in p for t in ("comprar", "compra", "lista de compra", "fornecedor"))
    acabando = any(t in p for t in ("acaba", "acabando", "falta", "faltar", "estoque"))
    if not (comprar or acabando):
        return None
    plano = ctx.compras
    if plano is None:
        return (
            "Ainda não tenho estoque para olhar. Cadastre os ingredientes e a ficha dos pratos "
            "em Estoque: com isso eu digo o que comprar e o que vai acabar."
        )
    dia = DIAS[plano.compra.weekday()]
    quando = quando_acaba(plano.compra, plano.hoje)
    if comprar:
        itens = [i for i in plano.itens if i.linha.embalagens]
        if not itens:
            return (
                f"Para a compra de {dia} ({quando}) não falta nada pela conta. "
                "Confira a geladeira mesmo assim."
            )
        lista = "; ".join(f"{i.insumo.nome}: {_texto_do_item(i)}" for i in itens[:8])
        resto = f" e mais {len(itens) - 8}" if len(itens) > 8 else ""
        return (
            f"Para a compra de {dia} ({quando}), que cobre até "
            f"{DIAS[plano.cobre[-1].weekday()]}: {lista}{resto}. A lista completa, com o porquê "
            "de cada número, está em Estoque, na aba Lista de compras."
        )
    urgentes = acabam_antes_da_compra(plano)
    depois = [i for i in plano.itens if i.situacao == Situacao.COMPRAR and i not in urgentes]
    if not urgentes and not depois:
        return f"Pela conta, nada acaba antes da compra de {dia} ({quando})."
    partes = []
    if urgentes:
        nomes = ", ".join(
            f"{i.insumo.nome.lower()} ({quando_acaba(i.acaba_em, plano.hoje)})" for i in urgentes
        )
        partes.append(f"Acaba antes da compra de {dia}: {nomes}.")
    if len(depois) > 4:
        partes.append(
            f"Outros {len(depois)} ingredientes dão até a compra e entram na lista de {dia}."
        )
    elif depois:
        nomes = ", ".join(i.insumo.nome.lower() for i in depois)
        partes.append(f"Precisa entrar na compra de {dia}: {nomes}.")
    return " ".join(partes) + " Confira na geladeira: a conta pode estar errada."


def responder_com_regras(pergunta: str, ctx: Contexto) -> str:
    """Respostas prontas para as perguntas mais comuns, quando a IA não está ligada."""
    p = _sem_acento(pergunta)
    if (sobre_perdas := responder_sobre_perdas(p, ctx)) is not None:
        return sobre_perdas
    if (sobre_estoque := responder_sobre_estoque(p, ctx)) is not None:
        return sobre_estoque
    if (sobre_cardapio := responder_sobre_cardapio(p, ctx)) is not None:
        return sobre_cardapio
    q = ctx.quatro_semanas
    if "mesa" in p and any(t in p for t in ("pior", "prejuizo", "mais", "custa", "parada")):
        pior = max(q.por_mesa, key=lambda m: m.perdido_centavos, default=None)
        if pior is None or pior.perdido_centavos == 0:
            return "Nas últimas 4 semanas nenhuma mesa deu prejuízo que dê para medir."
        return (
            f"A mesa {pior.numero} foi a que mais custou nas últimas 4 semanas: cerca de "
            f"{em_reais(pior.perdido_centavos)}. Ela fica em média "
            f"{_minutos(pior.parada_media_seg)} parada depois que o cliente sai. Combine quem "
            "libera essa mesa quando o salão encher."
        )
    if any(t in p for t in ("perdi", "perde", "dinheiro", "prejuizo", "custou", "quanto")):
        return (
            f"Nas últimas 4 semanas, cerca de {em_reais(q.perdido_total_centavos)} ficaram na "
            "mesa: "
            f"{em_reais(q.perdido_mesa_parada_centavos)} de mesa parada com o salão cheio e "
            f"{em_reais(q.perdido_desistencias_centavos)} de {_mesas(q.desistencias)} que "
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
            f"atendidas e cerca de {em_reais(ultima.perdido_total_centavos)} perdidos. Na noite "
            f"de comparação foram {antes.mesas_atendidas} mesas e "
            f"{em_reais(antes.perdido_total_centavos)}."
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
