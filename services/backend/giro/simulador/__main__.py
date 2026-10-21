"""Simulador de salão do GIRO.

uv run python -m giro.simulador listar
uv run python -m giro.simulador verificar [cenário ...]
uv run python -m giro.simulador ao-vivo --cenario sexta-lotada --inicio-em 4:30
uv run python -m giro.simulador ao-vivo --aleatorio --ritmo demo --mesas 1-14
"""

import argparse
import sys

from giro.seed import TOKEN_CAMERA_DEMO
from giro.simulador.ao_vivo import rodar_ao_vivo
from giro.simulador.cenario import (
    gerar_noite,
    ler_tempo,
    mostrar_tempo,
    por_nome,
    rodar_local,
    todos,
    verificar,
)


def _mesas(texto: str) -> list[int]:
    numeros: list[int] = []
    for parte in texto.split(","):
        if "-" in parte:
            de, ate = parte.split("-")
            numeros.extend(range(int(de), int(ate) + 1))
        else:
            numeros.append(int(parte))
    return numeros


def cmd_listar(_args) -> int:
    for cenario in todos():
        print(f"{cenario.nome:<20} {cenario.descricao}")
    return 0


def cmd_verificar(args) -> int:
    cenarios = [por_nome(n) for n in args.cenarios] if args.cenarios else todos()
    total_falhas = 0
    for cenario in cenarios:
        falhas = verificar(cenario, rodar_local(cenario))
        total_falhas += len(falhas)
        print(f"{'OK  ' if not falhas else 'FALHOU'} {cenario.nome}")
        for falha in falhas:
            print(f"       {falha}")
        if args.detalhes:
            for ocorrido in rodar_local(cenario):
                print(
                    f"       {mostrar_tempo(ocorrido.em):>6} mesa {ocorrido.mesa:>2} "
                    f"{ocorrido.tipo.value}"
                )
    print(f"\n{len(cenarios)} cenário(s), {total_falhas} falha(s).")
    return 1 if total_falhas else 0


def cmd_ao_vivo(args) -> int:
    if args.aleatorio:
        cenario = gerar_noite(_mesas(args.mesas), args.minutos, args.ritmo, args.semente)
    else:
        cenario = por_nome(args.cenario)
    try:
        rodar_ao_vivo(
            cenario,
            api=args.api,
            token=args.token,
            inicio_em=ler_tempo(args.inicio_em),
            repetir=args.repetir,
        )
    except KeyboardInterrupt:
        print("\nSimulador parado.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="giro.simulador",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="comando", required=True)

    sub.add_parser("listar", help="mostra os cenários disponíveis").set_defaults(func=cmd_listar)

    p_verificar = sub.add_parser("verificar", help="roda os cenários e confere os alertas")
    p_verificar.add_argument("cenarios", nargs="*")
    p_verificar.add_argument("--detalhes", action="store_true", help="mostra tudo que aconteceu")
    p_verificar.set_defaults(func=cmd_verificar)

    p_vivo = sub.add_parser("ao-vivo", help="manda o cenário para a API no relógio de verdade")
    origem = p_vivo.add_mutually_exclusive_group(required=True)
    origem.add_argument("--cenario")
    origem.add_argument("--aleatorio", action="store_true", help="noite gerada ao acaso")
    p_vivo.add_argument("--api", default="http://localhost:8000")
    p_vivo.add_argument("--token", default=TOKEN_CAMERA_DEMO, help="token da câmera")
    p_vivo.add_argument("--inicio-em", default="0:00", help="começa no meio, ex.: 4:30")
    p_vivo.add_argument("--repetir", action="store_true")
    p_vivo.add_argument("--mesas", default="1-14", help="só no aleatório, ex.: 1-14 ou 1,2,7")
    p_vivo.add_argument("--minutos", type=int, default=120, help="só no aleatório")
    p_vivo.add_argument("--ritmo", choices=["real", "demo"], default="demo")
    p_vivo.add_argument("--semente", type=int)
    p_vivo.set_defaults(func=cmd_ao_vivo)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
