"""Liga as contas das perdas ao banco: o livro do estoque no período, o que se vendeu e o
custo dos pratos, as compras (para o preço que subiu) e as contagens (curva A e lembrete).

Os valores em reais usam o preço médio de hoje de cada ingrediente: a pergunta é "quanto
isso me custaria agora", e assim a ficha e o estoque são medidos com a mesma régua."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from giro.dominio.estoque import TipoMovimento, custo_de
from giro.dominio.indicadores import noite_de
from giro.dominio.perdas import (
    Movimentos,
    PerdaDoInsumo,
    Subida,
    curva_abc,
    impacto_no_prato,
    perda_do_insumo,
    preco_da_nota,
    subida_recente,
)
from giro.modelos import (
    FichaTecnica,
    Insumo,
    ItemCardapio,
    ItemPedido,
    MovimentoEstoque,
    Restaurante,
)
from giro.servicos.resultados import Periodo, intervalo

JANELA = timedelta(days=28)  # curva ABC e preços que subiram
CONTAGEM_ATRASADA = timedelta(days=7)


@dataclass
class LinhaDePerda:
    insumo: Insumo
    perda: PerdaDoInsumo
    valor_escapou: int | None  # pelo preço médio de hoje; None sem preço
    valor_sem_registro: int | None
    prato: str | None  # o prato que mais usou o ingrediente no período
    por_porcao: int | None


@dataclass
class PerdaPorMotivo:
    motivo: str
    valor_centavos: int | None
    itens: list[tuple[Insumo, int]]  # (ingrediente, quanto se perdeu)


@dataclass
class PrecoQueSubiu:
    insumo: Insumo
    subida: Subida
    em: datetime
    pratos: list[tuple[str, int]]  # (prato, quanto passou a custar a mais, em centavos)


@dataclass
class RelatorioDePerdas:
    periodo: Periodo
    primeira_noite: date
    ultima_noite: date
    vendeu_centavos: int
    custo_pela_ficha_centavos: int
    itens_sem_custo: list[str]  # vendidos sem custo: ficam fora da conta
    registrada_centavos: int
    sem_registro_centavos: int
    ultima_contagem: datetime | None
    linhas: list[LinhaDePerda]  # só o que escapou, do que mais custou ao que menos
    por_motivo: list[PerdaPorMotivo]
    precos: list[PrecoQueSubiu]
    curva: dict[int, str] = field(default_factory=dict)

    @property
    def escapou_centavos(self) -> int:
        return self.registrada_centavos + self.sem_registro_centavos

    @property
    def custo_de_verdade_centavos(self) -> int:
        return self.custo_pela_ficha_centavos + self.escapou_centavos


def _valor(insumo: Insumo, quantidade: int) -> int | None:
    if insumo.custo_centavos is None:
        return None
    return round(custo_de(quantidade, insumo.unidade, insumo.custo_centavos))


def _somas(
    db: Session, restaurante_id: int, inicio: datetime, fim: datetime
) -> dict[int, Movimentos]:
    somas: dict[int, dict[str, int]] = defaultdict(dict)
    for insumo_id, tipo, total in db.execute(
        select(
            MovimentoEstoque.insumo_id, MovimentoEstoque.tipo, func.sum(MovimentoEstoque.quantidade)
        )
        .where(
            MovimentoEstoque.restaurante_id == restaurante_id,
            MovimentoEstoque.em >= inicio,
            MovimentoEstoque.em < fim,
            # Compra entra no estoque e o saldo de partida já estava lá: nenhum dos dois é
            # saída, perda ou sobra.
            MovimentoEstoque.tipo.not_in([TipoMovimento.COMPRA.value, TipoMovimento.INICIAL.value]),
        )
        .group_by(MovimentoEstoque.insumo_id, MovimentoEstoque.tipo)
    ):
        somas[insumo_id][tipo] = int(total or 0)
    return {i: Movimentos(**s) for i, s in somas.items()}


def ultimas_contagens(db: Session, restaurante_id: int) -> dict[int, datetime]:
    """Quando cada ingrediente foi contado pela última vez."""
    return dict(
        db.execute(
            select(MovimentoEstoque.insumo_id, func.max(MovimentoEstoque.em))
            .where(
                MovimentoEstoque.restaurante_id == restaurante_id,
                MovimentoEstoque.tipo == TipoMovimento.CONTAGEM.value,
            )
            .group_by(MovimentoEstoque.insumo_id)
        ).all()
    )


def curva_do_restaurante(
    db: Session, restaurante_id: int, agora: datetime, insumos: list[Insumo] | None = None
) -> dict[int, str]:
    """Curva ABC pelo que saiu de cada ingrediente nas últimas 4 semanas, em reais de hoje."""
    insumos = insumos if insumos is not None else _insumos(db, restaurante_id)
    somas = _somas(db, restaurante_id, agora - JANELA, agora)
    gasto = {}
    for insumo in insumos:
        saiu = perda_do_insumo(somas.get(insumo.id, Movimentos())).saiu
        gasto[insumo.id] = max(_valor(insumo, saiu) or 0, 0)
    return curva_abc(gasto)


def _insumos(db: Session, restaurante_id: int) -> list[Insumo]:
    return list(
        db.scalars(
            select(Insumo)
            .where(Insumo.restaurante_id == restaurante_id, Insumo.ativo.is_(True))
            .order_by(Insumo.nome)
        )
    )


def precos_das_notas(db: Session, insumo: Insumo, limite: int = 2) -> list[tuple[datetime, int]]:
    """As últimas compras com valor: (quando, preço por kg, litro ou unidade)."""
    linhas = db.execute(
        select(MovimentoEstoque.em, MovimentoEstoque.quantidade, MovimentoEstoque.valor_centavos)
        .where(
            MovimentoEstoque.insumo_id == insumo.id,
            MovimentoEstoque.tipo == TipoMovimento.COMPRA.value,
            MovimentoEstoque.valor_centavos.is_not(None),
            MovimentoEstoque.quantidade > 0,
        )
        .order_by(MovimentoEstoque.em.desc(), MovimentoEstoque.id.desc())
        .limit(limite)
    ).all()
    return [(em, preco_da_nota(q, v, insumo.unidade)) for em, q, v in linhas]


def pratos_que_encarecem(db: Session, insumo: Insumo, subida: Subida) -> list[tuple[str, int]]:
    """Os pratos que usam o ingrediente e quanto cada um passou a custar a mais."""
    linhas = db.execute(
        select(ItemCardapio.nome, FichaTecnica.quantidade)
        .join(FichaTecnica, FichaTecnica.item_id == ItemCardapio.id)
        .where(FichaTecnica.insumo_id == insumo.id, ItemCardapio.ativo.is_(True))
    ).all()
    pratos = [(nome, impacto_no_prato(subida, q, insumo.unidade)) for nome, q in linhas]
    return sorted(pratos, key=lambda p: (-p[1], p[0]))


def texto_do_preco(insumo: Insumo, subida: Subida, pratos: list[tuple[str, int]]) -> str:
    """O aviso no celular do dono: "Muçarela subiu 15%: de R$ 42/kg para R$ 48,30/kg..." """
    medida = {"g": "/kg", "ml": "/L"}.get(insumo.unidade, " a unidade")
    texto = (
        f"{insumo.nome} subiu {subida.pct}%: de {_reais(subida.antes_centavos)}{medida} para "
        f"{_reais(subida.agora_centavos)}{medida}."
    )
    mais = [p for p in pratos if p[1] > 0][:2]
    if mais:
        partes = " e ".join(
            f"{nome} passou a custar {_reais(a_mais)} a mais" for nome, a_mais in mais
        )
        texto += f" {partes} por prato."
    return texto


def _reais(centavos: int) -> str:
    inteiro, resto = divmod(abs(centavos), 100)
    valor = f"{inteiro:,}".replace(",", ".") + (f",{resto:02d}" if resto else "")
    return f"R$ {valor}"


def relatorio_de_perdas(
    db: Session, restaurante: Restaurante, periodo: Periodo, agora: datetime
) -> RelatorioDePerdas:
    hoje = noite_de(agora)
    inicio, fim = intervalo(periodo, hoje)
    fim = min(fim, agora)
    insumos = _insumos(db, restaurante.id)
    somas = _somas(db, restaurante.id, inicio, fim)

    # Vendas do período: quanto entrou e quanto os pratos custam (pela ficha ou o digitado).
    vendeu = custo_ficha = 0
    sem_custo: set[str] = set()
    vendidos: dict[int, int] = defaultdict(int)
    for item_id, quantidade, preco, custo, nome in db.execute(
        select(
            ItemPedido.item_id,
            ItemPedido.quantidade,
            ItemPedido.preco_unit_centavos,
            ItemCardapio.custo_centavos,
            ItemCardapio.nome,
        )
        .join(ItemCardapio, ItemPedido.item_id == ItemCardapio.id)
        .where(
            ItemPedido.restaurante_id == restaurante.id,
            ItemPedido.cancelado_em.is_(None),
            ItemPedido.lancado_em >= inicio,
            ItemPedido.lancado_em < fim,
        )
    ):
        vendeu += quantidade * preco
        vendidos[item_id] += quantidade
        if custo is None:
            sem_custo.add(nome)
        else:
            custo_ficha += quantidade * custo

    # O prato que mais usou cada ingrediente no período (para a dica da porção).
    principal: dict[int, tuple[str, int, int]] = {}
    for item_id, nome, insumo_id, por_porcao in db.execute(
        select(ItemCardapio.id, ItemCardapio.nome, FichaTecnica.insumo_id, FichaTecnica.quantidade)
        .join(FichaTecnica, FichaTecnica.item_id == ItemCardapio.id)
        .where(ItemCardapio.restaurante_id == restaurante.id)
    ):
        uso = vendidos.get(item_id, 0) * por_porcao
        if uso and uso > principal.get(insumo_id, ("", 0, 0))[2]:
            principal[insumo_id] = (nome, por_porcao, uso)

    linhas = []
    registrada = sem_registro = 0
    for insumo in insumos:
        perda = perda_do_insumo(somas.get(insumo.id, Movimentos()))
        if perda.escapou == 0 and perda.registrada == 0 and perda.sem_registro == 0:
            continue
        valor_registrada = _valor(insumo, perda.registrada) or 0
        valor_sem = _valor(insumo, perda.sem_registro)
        registrada += valor_registrada
        sem_registro += valor_sem or 0
        prato = principal.get(insumo.id)
        linhas.append(
            LinhaDePerda(
                insumo=insumo,
                perda=perda,
                valor_escapou=_valor(insumo, perda.escapou),
                valor_sem_registro=valor_sem,
                prato=prato[0] if prato else None,
                por_porcao=prato[1] if prato else None,
            )
        )
    linhas.sort(key=lambda linha: (-(linha.valor_escapou or 0), linha.insumo.nome))

    # Perdas registradas, por motivo (inclui o prato cancelado depois do "Pronto").
    por_motivo: dict[str, list[tuple[Insumo, int]]] = defaultdict(list)
    por_id = {i.id: i for i in insumos}
    for motivo, insumo_id, total in db.execute(
        select(
            MovimentoEstoque.motivo,
            MovimentoEstoque.insumo_id,
            func.sum(MovimentoEstoque.quantidade),
        )
        .where(
            MovimentoEstoque.restaurante_id == restaurante.id,
            MovimentoEstoque.tipo == TipoMovimento.PERDA.value,
            MovimentoEstoque.em >= inicio,
            MovimentoEstoque.em < fim,
        )
        .group_by(MovimentoEstoque.motivo, MovimentoEstoque.insumo_id)
    ):
        if insumo_id in por_id and total:
            por_motivo[motivo or "Outro"].append((por_id[insumo_id], -int(total)))
    motivos = []
    for motivo, itens in por_motivo.items():
        valores = [_valor(i, q) for i, q in itens]
        total = None if None in valores else sum(v or 0 for v in valores)
        motivos.append(PerdaPorMotivo(motivo, total, sorted(itens, key=lambda x: x[0].nome)))
    motivos.sort(key=lambda m: (-(m.valor_centavos or 0), m.motivo))

    # Preços que subiram nas últimas 4 semanas e continuam altos.
    precos = []
    for insumo in insumos:
        achou = subida_recente(list(reversed(precos_das_notas(db, insumo, 20))), agora - JANELA)
        if achou is not None:
            subida, quando = achou
            precos.append(
                PrecoQueSubiu(insumo, subida, quando, pratos_que_encarecem(db, insumo, subida))
            )
    precos.sort(key=lambda p: -p.subida.pct)

    ultima = db.scalar(
        select(func.max(MovimentoEstoque.em)).where(
            MovimentoEstoque.restaurante_id == restaurante.id,
            MovimentoEstoque.tipo == TipoMovimento.CONTAGEM.value,
            MovimentoEstoque.em >= inicio,
            MovimentoEstoque.em < fim,
        )
    )
    return RelatorioDePerdas(
        periodo=periodo,
        primeira_noite=noite_de(inicio),
        ultima_noite=hoje,
        vendeu_centavos=vendeu,
        custo_pela_ficha_centavos=custo_ficha,
        itens_sem_custo=sorted(sem_custo),
        registrada_centavos=registrada,
        sem_registro_centavos=sem_registro,
        ultima_contagem=ultima,
        linhas=linhas,
        por_motivo=motivos,
        precos=precos,
        curva=curva_do_restaurante(db, restaurante.id, agora, insumos),
    )


def contagem_atrasada(
    db: Session, restaurante_id: int, agora: datetime, curva: dict[int, str] | None = None
) -> list[Insumo]:
    """Os ingredientes da curva A sem contagem há mais de uma semana."""
    insumos = _insumos(db, restaurante_id)
    curva = curva if curva is not None else curva_do_restaurante(db, restaurante_id, agora, insumos)
    contados = ultimas_contagens(db, restaurante_id)
    return [
        i
        for i in insumos
        if curva.get(i.id) == "A"
        and (contados.get(i.id) is None or agora - contados[i.id] > CONTAGEM_ATRASADA)
    ]


def ingredientes_da_curva(
    db: Session, restaurante_id: int, curva: dict[int, str], classe: str
) -> list[Insumo]:
    return [i for i in _insumos(db, restaurante_id) if curva.get(i.id) == classe]
