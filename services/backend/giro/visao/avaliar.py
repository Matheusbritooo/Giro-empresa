"""Mede a visão num vídeo (ou pasta de fotos) de salão, sem API e sem banco.

  uv run --extra visao --extra conector python -m giro.visao.avaliar \\
      --fonte /videos/salao.mp4 --mesas mesas.yaml [--gabarito gabarito.yaml] [--varrer]

mesas.yaml (desenho das mesas, pontos de 0 a 1; dá para copiar de GET /api/ingest/configuracao):
  1: [[0.10, 0.20], [0.30, 0.20], [0.30, 0.45], [0.10, 0.45]]
  2: [[0.55, 0.20], [0.80, 0.20], [0.80, 0.45], [0.55, 0.45]]

gabarito.yaml (contagem feita à mão olhando o vídeo, em minuto:segundo):
  "0:00": {1: [0, 0], 2: [2, 0]}      # mesa: [sentados, em pé]
  "0:10": {1: [3, 1], 2: [2, 0]}

Sem gabarito, mostra a contagem foto a foto e os eventos que a máquina de estados geraria.
Com gabarito, mostra o acerto. Com --varrer, testa vários valores de `proporcao_em_pe`.
Nenhuma foto é gravada: o vídeo é lido direto do arquivo.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import yaml
from PIL import Image

from giro.conector import EXTENSOES_FOTO, de_pasta, de_video
from giro.dominio.mesa import MaquinaMesa, Observacao, Regras
from giro.simulador.cenario import ler_tempo, mostrar_tempo
from giro.visao.detector import DetectorYolox, Pessoa
from giro.visao.leitura import Ajustes, ZonaMesa, ler
from giro.visao.modelo import MODELOS, garantir_modelo


@dataclass(frozen=True)
class Foto:
    segundo: float
    pessoas: list[Pessoa]


@dataclass(frozen=True)
class Acerto:
    comparacoes: int
    ocupacao: float  # acertou se a mesa tinha ou não gente sentada
    sentados: float  # acertou o número exato de sentados
    em_pe: float  # acertou se havia alguém em pé junto à mesa


def carregar_mesas(caminho: Path) -> list[ZonaMesa]:
    dados = yaml.safe_load(caminho.read_text(encoding="utf-8"))
    return [ZonaMesa(int(n), [tuple(p) for p in pontos]) for n, pontos in dados.items()]


def carregar_gabarito(caminho: Path) -> dict[float, dict[int, tuple[int, int]]]:
    dados = yaml.safe_load(caminho.read_text(encoding="utf-8"))
    return {
        ler_tempo(t).total_seconds(): {int(m): (int(v[0]), int(v[1])) for m, v in mesas.items()}
        for t, mesas in dados.items()
    }


def detectar_tudo(fonte: Path, detector: DetectorYolox, intervalo: float) -> list[Foto]:
    """Roda o detector uma vez por foto. A regra de mesa é barata e roda depois, várias vezes."""
    quadros = de_pasta(fonte, intervalo) if fonte.is_dir() else de_video(fonte, intervalo)
    fotos = []
    for segundo, imagem in quadros:
        rgb = Image.fromarray(cv2.cvtColor(imagem, cv2.COLOR_BGR2RGB))
        fotos.append(Foto(segundo, detector.detectar(rgb, limiar=0.1)))
    return fotos


def contar(fotos: list[Foto], zonas: list[ZonaMesa], ajustes: Ajustes):
    return [(f.segundo, ler(f.pessoas, zonas, ajustes).por_mesa) for f in fotos]


def comparar(contagens, gabarito, tolerancia: float = 5) -> Acerto:
    ocupacao = sentados = em_pe = total = 0
    for segundo, por_mesa in contagens:
        certo = next((g for t, g in gabarito.items() if abs(t - segundo) <= tolerancia), None)
        if certo is None:
            continue
        for mesa, (s_certo, e_certo) in certo.items():
            s_lido, e_lido = por_mesa.get(mesa, (0, 0))
            total += 1
            ocupacao += (s_lido > 0) == (s_certo > 0)
            sentados += s_lido == s_certo
            em_pe += (e_lido > 0) == (e_certo > 0)
    if total == 0:
        raise SystemExit("nenhum instante do gabarito bate com as fotos do vídeo")
    return Acerto(total, ocupacao / total, sentados / total, em_pe / total)


def eventos(contagens, zonas: list[ZonaMesa]) -> list[str]:
    """O que a máquina de estados faria com essas contagens (sentou, atendida, saiu...)."""
    inicio = datetime(2026, 1, 2, 20, 0, tzinfo=UTC)
    maquinas = {z.numero: MaquinaMesa(regras=Regras()) for z in zonas}
    linhas = []
    for segundo, por_mesa in contagens:
        em = inicio + timedelta(seconds=segundo)
        for mesa, maquina in maquinas.items():
            sentados, em_pe = por_mesa.get(mesa, (0, 0))
            for evento in maquina.observar(Observacao(em, sentados, em_pe)):
                quando = mostrar_tempo(evento.em - inicio)
                linhas.append(f"{quando:>6}  mesa {mesa:>2}  {evento.tipo.value}")
    return linhas


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="giro.visao.avaliar",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--fonte", type=Path, required=True, help="vídeo ou pasta de fotos")
    parser.add_argument("--mesas", type=Path, required=True, help="desenho das mesas (YAML)")
    parser.add_argument("--gabarito", type=Path, help="contagem feita à mão (YAML)")
    parser.add_argument("--modelo", default="yolox_s", choices=sorted(MODELOS))
    parser.add_argument("--intervalo", type=float, default=10)
    parser.add_argument("--proporcao-em-pe", type=float, default=Ajustes.proporcao_em_pe)
    parser.add_argument("--margem", type=float, default=Ajustes.margem_atendimento)
    parser.add_argument("--varrer", action="store_true", help="testa proporcao_em_pe de 1,4 a 3,4")
    args = parser.parse_args()

    if not args.fonte.exists() or (
        args.fonte.is_file() and args.fonte.suffix.lower() in EXTENSOES_FOTO
    ):
        raise SystemExit("--fonte precisa ser um vídeo ou uma pasta de fotos")
    zonas = carregar_mesas(args.mesas)
    modelo = MODELOS[args.modelo]
    detector = DetectorYolox(garantir_modelo(modelo.nome), modelo.tamanho)
    print(f"Detectando pessoas em {args.fonte.name} com {modelo.nome}...", flush=True)
    fotos = detectar_tudo(args.fonte, detector, args.intervalo)
    ajustes = Ajustes(proporcao_em_pe=args.proporcao_em_pe, margem_atendimento=args.margem)
    contagens = contar(fotos, zonas, ajustes)
    print(f"{len(fotos)} foto(s) analisadas.\n")

    if args.gabarito is None:
        for segundo, por_mesa in contagens:
            ocupadas = ", ".join(
                f"mesa {m}: {s}s {e}p" for m, (s, e) in sorted(por_mesa.items()) if s or e
            )
            print(f"{mostrar_tempo(timedelta(seconds=segundo)):>6}  {ocupadas or '-'}")
        print("\nEventos que o sistema geraria:")
        print("\n".join(eventos(contagens, zonas)) or "  nenhum")
        return 0

    gabarito = carregar_gabarito(args.gabarito)
    acerto = comparar(contagens, gabarito)
    print(
        f"Acerto em {acerto.comparacoes} comparações (mesa x instante):\n"
        f"  mesa ocupada ou livre: {acerto.ocupacao:.0%}\n"
        f"  número de sentados:    {acerto.sentados:.0%}\n"
        f"  garçom junto à mesa:   {acerto.em_pe:.0%}"
    )
    if args.varrer:
        print("\nproporcao_em_pe  ocupada  sentados  garçom")
        for decimo in range(14, 35):
            teste = replace(ajustes, proporcao_em_pe=decimo / 10)
            a = comparar(contar(fotos, zonas, teste), gabarito)
            valores = f"{a.ocupacao:>7.0%}  {a.sentados:>8.0%}  {a.em_pe:>6.0%}"
            print(f"{teste.proporcao_em_pe:>15.1f}  {valores}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
