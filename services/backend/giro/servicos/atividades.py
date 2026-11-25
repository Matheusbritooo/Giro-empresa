"""O histórico de quem fez o quê no restaurante. As rotas chamam `registrar` antes do commit,
com a frase pronta; aqui ficam as frases que se repetem (o que mudou de um valor para outro).

Só entra o que muda o dinheiro ou a operação: preço, custo, "acabou", ficha, compra, perda,
contagem, cancelamento, ajustes, equipe, mesas e câmeras. Não entra senha, e-mail, token nem
nada de cliente. Lançar pedido, "Pronto" e "Liberar mesa" ficam fora: acontecem o tempo todo e
já têm a própria tela.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy.orm import Session

from giro.banco import agora
from giro.modelos import Atividade, Usuario

TAMANHO = 300  # a coluna `texto`


class GrupoAtividade(StrEnum):
    CARDAPIO = "cardapio"
    PEDIDO = "pedido"
    ESTOQUE = "estoque"
    EQUIPE = "equipe"
    AJUSTES = "ajustes"
    MESAS = "mesas"
    CAIXA = "caixa"


def registrar(
    db: Session,
    restaurante_id: int,
    usuario: Usuario | None,
    grupo: GrupoAtividade,
    texto: str,
    em: datetime | None = None,
) -> None:
    """Põe a linha na sessão; entra no banco junto com o commit da mudança."""
    if len(texto) > TAMANHO:
        texto = texto[: TAMANHO - 1] + "…"
    db.add(
        Atividade(
            restaurante_id=restaurante_id,
            usuario_id=usuario.id if usuario else None,
            grupo=grupo.value,
            texto=texto,
            em=em or agora(),
        )
    )


def reais(centavos: int | None) -> str:
    """R$ 62 ou R$ 14,42; vazio vira "sem valor"."""
    if centavos is None:
        return "sem valor"
    inteiro, resto = divmod(abs(centavos), 100)
    sinal = "-" if centavos < 0 else ""
    milhar = f"{inteiro:,}".replace(",", ".")
    return f"{sinal}R$ {milhar}" + (f",{resto:02d}" if resto else "")


def de_para(rotulo: str, antes: object, depois: object) -> str:
    """ "Preço de Lasanha: de R$ 58 para R$ 62"."""
    return f"{rotulo}: de {antes} para {depois}"


def juntar(frases: list[str], limite: int | None = None) -> str:
    """ "a, b e c"; com limite, "a, b, c e mais 4"."""
    if limite is not None and len(frases) > limite:
        return f"{', '.join(frases[:limite])} e mais {len(frases) - limite}"
    if len(frases) <= 1:
        return "".join(frases)
    return f"{', '.join(frases[:-1])} e {frases[-1]}"


NOME_DO_PAPEL = {
    "admin_giro": "equipe GIRO",
    "dono": "dono",
    "gerente": "gerente",
    "equipe": "equipe do salão",
}

DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


def _dias(valor: str) -> str:
    return juntar([DIAS[int(d)] for d in valor.split(",") if d])


# Como cada ajuste aparece no histórico: (nome, como mostrar o valor).
AJUSTES: dict[str, tuple[str, object]] = {
    "nome": ("o nome do restaurante", str),
    "cidade": ("a cidade", lambda v: v or "sem cidade"),
    "alerta_atendimento_seg": ("o alerta de atendimento", lambda v: f"{v // 60} min"),
    "alerta_visita_min": (
        "o alerta de mesa sem visita",
        lambda v: f"{v} min" if v else "desligado",
    ),
    "ticket_medio_centavos": ("o gasto médio por pessoa", reais),
    "abre_as": ("o horário de abrir", str),
    "fecha_as": ("o horário de fechar", str),
    "dias_compra": ("os dias de compra", _dias),
    "folga_compra_pct": ("a folga da lista de compras", lambda v: f"{v}%"),
}


def o_que_mudou_nos_ajustes(restaurante, mudancas: dict) -> list[str]:
    """ "o gasto médio por pessoa de R$ 85 para R$ 90"; o que não mudou não entra."""
    frases = []
    for campo, (rotulo, mostrar) in AJUSTES.items():
        if campo in mudancas and mudancas[campo] != getattr(restaurante, campo):
            antes, depois = getattr(restaurante, campo), mudancas[campo]
            frases.append(f"{rotulo} de {mostrar(antes)} para {mostrar(depois)}")  # type: ignore[operator]
    return frases
