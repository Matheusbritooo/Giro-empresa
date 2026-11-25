"""O que mudou de uma semana para a outra, sem banco nem API: o Copiloto avisa sozinho.

Compara as 7 últimas noites fechadas com as 7 anteriores e só fala do que mudou de verdade:
a mudança tem que ser grande em proporção E em valor (uma desistência a mais numa semana fraca
não é notícia). Piora vem primeiro; uma melhora, se houver, fecha a lista para o dono saber
que a mudança que fez deu certo.

    semana anterior        semana que passou        hoje
    ├── 7 noites ──────────┼── 7 noites ────────────┤
"""

from __future__ import annotations

from dataclasses import dataclass

from giro.dominio.indicadores import Indicadores, NotasDosClientes

MAXIMO = 3  # frases por semana: mais que isso ninguém lê no celular
MINIMO_MESAS = 20  # semana com menos mesas atendidas que isso não tem comparação que valha
MINIMO_NOTAS = 10


@dataclass(frozen=True)
class Mudanca:
    tipo: str  # espera, parada, desistencias, mesas, ficou_na_mesa, nota
    piorou: bool
    texto: str
    href: str  # onde ver mais
    peso: float = 0.0  # para ordenar: quanto maior, mais importante


def _min(segundos: float) -> str:
    return f"{segundos / 60:.1f}".replace(".", ",")


def _reais(centavos: int) -> str:
    return f"R$ {centavos / 100:,.0f}".replace(",", ".")


def _variou(atual: float, antes: float) -> float:
    return (atual - antes) / antes if antes else 0.0


def mudancas_da_semana(
    atual: Indicadores,
    antes: Indicadores,
    notas_atual: NotasDosClientes | None = None,
    notas_antes: NotasDosClientes | None = None,
) -> list[Mudanca]:
    if atual.mesas_atendidas < MINIMO_MESAS or antes.mesas_atendidas < MINIMO_MESAS:
        return []
    achadas: list[Mudanca] = []

    # Espera até o garçom: 25% e pelo menos 1 minuto.
    if atual.espera_media_seg is not None and antes.espera_media_seg is not None:
        v = _variou(atual.espera_media_seg, antes.espera_media_seg)
        diferenca = abs(atual.espera_media_seg - antes.espera_media_seg)
        if abs(v) >= 0.25 and diferenca >= 60:
            piorou = v > 0
            achadas.append(
                Mudanca(
                    "espera",
                    piorou,
                    f"A espera até o garçom {'subiu' if piorou else 'caiu'} de "
                    f"{_min(antes.espera_media_seg)} para {_min(atual.espera_media_seg)} min "
                    "nesta semana." + (" Vale olhar a escala nas horas de pico." if piorou else ""),
                    "/resultados?periodo=semana",
                    abs(v),
                )
            )

    # Mesa parada suja: 25% e pelo menos 1 minuto. Diz qual mesa pesou mais.
    if atual.parada_media_seg is not None and antes.parada_media_seg is not None:
        v = _variou(atual.parada_media_seg, antes.parada_media_seg)
        diferenca = abs(atual.parada_media_seg - antes.parada_media_seg)
        if abs(v) >= 0.25 and diferenca >= 60:
            piorou = v > 0
            pior = max(
                (m for m in atual.por_mesa if m.parada_media_seg),
                key=lambda m: m.parada_media_seg or 0,
                default=None,
            )
            qual = (
                f" A mesa {pior.numero} foi a que mais esperou limpeza." if piorou and pior else ""
            )
            achadas.append(
                Mudanca(
                    "parada",
                    piorou,
                    f"A mesa ficou parada suja {_min(atual.parada_media_seg)} min em média, "
                    f"contra {_min(antes.parada_media_seg)} na semana anterior.{qual}",
                    "/resultados?periodo=semana",
                    abs(v),
                )
            )

    # Quem foi embora sem atendimento: 50% a mais e pelo menos 3 mesas.
    d_atual, d_antes = atual.desistencias, antes.desistencias
    if d_atual - d_antes >= 3 and d_atual >= d_antes * 1.5:
        achadas.append(
            Mudanca(
                "desistencias",
                True,
                f"{d_atual} mesas foram embora sem atendimento, contra {d_antes} na semana "
                "anterior.",
                "/resultados?periodo=semana",
                _variou(d_atual, max(d_antes, 1)),
            )
        )
    elif d_antes - d_atual >= 3 and d_atual <= d_antes * 0.5:
        achadas.append(
            Mudanca(
                "desistencias",
                False,
                f"Só {d_atual} {'mesa foi' if d_atual == 1 else 'mesas foram'} embora sem "
                f"atendimento, contra {d_antes} na semana anterior.",
                "/resultados?periodo=semana",
                abs(_variou(d_atual, d_antes)),
            )
        )

    # Movimento: 15% e pelo menos 10 mesas.
    v = _variou(atual.mesas_atendidas, antes.mesas_atendidas)
    if abs(v) >= 0.15 and abs(atual.mesas_atendidas - antes.mesas_atendidas) >= 10:
        piorou = v < 0
        achadas.append(
            Mudanca(
                "mesas",
                piorou,
                f"O salão atendeu {abs(round(v * 100))}% {'menos' if piorou else 'mais'} "
                f"mesas: {atual.mesas_atendidas} contra {antes.mesas_atendidas}.",
                "/resultados?periodo=semana",
                abs(v),
            )
        )

    # Dinheiro que ficou na mesa: 25% e pelo menos R$ 300.
    f_atual, f_antes = atual.perdido_total_centavos, antes.perdido_total_centavos
    v = _variou(f_atual, f_antes)
    if f_antes and abs(v) >= 0.25 and abs(f_atual - f_antes) >= 30_000:
        piorou = v > 0
        achadas.append(
            Mudanca(
                "ficou_na_mesa",
                piorou,
                f"Ficaram {_reais(f_atual)} na mesa nesta semana, contra {_reais(f_antes)} na "
                "anterior.",
                "/resultados?periodo=semana",
                abs(v),
            )
        )

    # Nota dos clientes: 0,3 ponto, com notas suficientes nas duas semanas.
    if (
        notas_atual
        and notas_antes
        and notas_atual.media is not None
        and notas_antes.media is not None
        and notas_atual.quantidade >= MINIMO_NOTAS
        and notas_antes.quantidade >= MINIMO_NOTAS
        and abs(notas_atual.media - notas_antes.media) >= 0.3
    ):
        piorou = notas_atual.media < notas_antes.media
        media = lambda x: f"{x:.1f}".replace(".", ",")  # noqa: E731
        achadas.append(
            Mudanca(
                "nota",
                piorou,
                f"A nota dos clientes {'caiu' if piorou else 'subiu'} de "
                f"{media(notas_antes.media)} para {media(notas_atual.media)}.",
                "/resultados?periodo=semana",
                abs(notas_atual.media - notas_antes.media),
            )
        )

    pioras = sorted((m for m in achadas if m.piorou), key=lambda m: -m.peso)
    melhoras = sorted((m for m in achadas if not m.piorou), key=lambda m: -m.peso)
    # Até 3 frases; com melhora, ela fecha a lista (uma só).
    return pioras[: MAXIMO - 1] + melhoras[:1] if melhoras else pioras[:MAXIMO]
