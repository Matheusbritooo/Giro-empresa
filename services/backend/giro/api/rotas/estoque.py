"""Estoque do restaurante (etapa 3 do cardápio).

Quem faz o quê:
- equipe vê o estoque e a ficha dos pratos (sem valores) e registra perda;
- gerente também cadastra ingredientes, lança compra com o valor da nota e conta o estoque;
- dono vê tudo, inclusive o custo dos pratos pela ficha.

A lista de compras (gerente e dono) olha as últimas 4 noites iguais de cada prato, a ficha e
o estoque de agora (giro/dominio/compras.py).
"""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from giro.api.deps import (
    GESTAO,
    Db,
    RestauranteAlvo,
    Servico,
    UsuarioAtual,
    exigir_papel,
    restaurante_permitido,
)
from giro.banco import agora
from giro.dominio.estoque import TipoMovimento
from giro.dominio.perdas import preco_da_nota, subida_de_preco
from giro.esquemas import (
    CompraEntrada,
    ContagemEntrada,
    ContagemSaida,
    DiferencaSaida,
    EstoqueSaida,
    FichaSaida,
    InsumoAtualizacao,
    InsumoEntrada,
    InsumoSaida,
    ItemPerdidoSaida,
    LinhaCompraSaida,
    LinhaFicha,
    LinhaPerdaSaida,
    ListaDeComprasSaida,
    MovimentoSaida,
    NoiteDoPrato,
    PerdaEntrada,
    PerdaPorMotivoSaida,
    PerdasSaida,
    PratoMaisCaroSaida,
    PratoNaConta,
    PrecoQueSubiuSaida,
    PrevisaoDoPratoSaida,
)
from giro.modelos import (
    FichaTecnica,
    Insumo,
    ItemCardapio,
    ItemPedido,
    MovimentoEstoque,
    Papel,
    Restaurante,
    Usuario,
)
from giro.servicos import estoque as servico_estoque
from giro.servicos import perdas as servico_perdas
from giro.servicos.compras import plano_de_compras
from giro.servicos.resultados import Periodo

router = APIRouter(prefix="/api/estoque", tags=["estoque"])

VEEM_CUSTO = (Papel.DONO, Papel.ADMIN_GIRO)
MOVIMENTOS_NA_TELA = 40


def _ve_valores(usuario: Usuario) -> bool:
    return usuario.papel in GESTAO


def insumo_saida(insumo: Insumo, usuario: Usuario) -> InsumoSaida:
    saida = InsumoSaida.model_validate(insumo)
    if not _ve_valores(usuario):
        saida.custo_centavos = None
    return saida


def _insumo(db, insumo_id: int, usuario: Usuario) -> Insumo:
    insumo = db.get(Insumo, insumo_id)
    if insumo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ingrediente não encontrado")
    restaurante_permitido(usuario, insumo.restaurante_id)
    return insumo


def fichas_saida(db, restaurante_id: int, usuario: Usuario) -> list[FichaSaida]:
    ve_custo = usuario.papel in VEEM_CUSTO
    linhas = db.execute(
        select(FichaTecnica.item_id, FichaTecnica.insumo_id, FichaTecnica.quantidade)
        .where(FichaTecnica.restaurante_id == restaurante_id)
        .order_by(FichaTecnica.item_id, FichaTecnica.id)
    ).all()
    por_item: dict[int, list[LinhaFicha]] = {}
    for item_id, insumo_id, quantidade in linhas:
        por_item.setdefault(item_id, []).append(
            LinhaFicha(insumo_id=insumo_id, quantidade=quantidade)
        )
    custos = servico_estoque.custos_das_fichas(db, restaurante_id) if ve_custo else {}
    outros = dict(
        db.execute(
            select(ItemCardapio.id, ItemCardapio.custo_outros_centavos).where(
                ItemCardapio.restaurante_id == restaurante_id
            )
        ).all()
    )
    return [
        FichaSaida(
            item_id=item_id,
            linhas=ls,
            custo_outros_centavos=outros.get(item_id) if ve_custo else None,
            custo_centavos=custos.get(item_id),
        )
        for item_id, ls in por_item.items()
    ]


@router.get("")
def ver_estoque(db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo) -> EstoqueSaida:
    """Gestão vê também o ingrediente que saiu de uso (para voltar com ele); a equipe, não."""
    gestao = usuario.papel in GESTAO
    insumos = db.scalars(
        select(Insumo).where(Insumo.restaurante_id == restaurante_id).order_by(Insumo.nome)
    ).all()
    momento = agora()
    plano = plano_de_compras(db, db.get_one(Restaurante, restaurante_id), momento)
    previsto = {i.insumo.id: i for i in plano.itens}
    curva = servico_perdas.curva_do_restaurante(db, restaurante_id, momento)
    contados = servico_perdas.ultimas_contagens(db, restaurante_id)
    saidas = []
    for insumo in insumos:
        if not (gestao or insumo.ativo):
            continue
        saida = insumo_saida(insumo, usuario)
        if (item := previsto.get(insumo.id)) is not None:
            saida.situacao, saida.acaba_em = item.situacao.value, item.acaba_em
        saida.curva = curva.get(insumo.id) if insumo.ativo else None
        saida.contado_em = contados.get(insumo.id)
        saidas.append(saida)
    return EstoqueSaida(
        insumos=saidas,
        fichas=fichas_saida(db, restaurante_id, usuario),
        mostra_valores=_ve_valores(usuario),
        mostra_custo=usuario.papel in VEEM_CUSTO,
        hoje=plano.hoje,
        proxima_compra=plano.compra,
        cobre=plano.cobre,
    )


@router.get("/compras", dependencies=[exigir_papel(*GESTAO)])
def ver_lista_de_compras(
    db: Db,
    restaurante_id: RestauranteAlvo,
    folga: Annotated[int | None, Query(ge=0, le=100)] = None,
) -> ListaDeComprasSaida:
    """A lista da próxima compra, com o porquê de cada número. `folga` muda só esta conta
    (um fim de semana de feriado, por exemplo); a de sempre fica em Ajustes."""
    restaurante = db.get_one(Restaurante, restaurante_id)
    plano = plano_de_compras(db, restaurante, agora(), folga)
    comprar = sorted(
        (i for i in plano.itens if i.linha.embalagens),
        key=lambda i: (i.insumo.onde_compra or "~", i.insumo.nome),
    )
    valores = [i.valor_centavos for i in comprar]
    return ListaDeComprasSaida(
        hoje=plano.hoje,
        compra=plano.compra,
        antes=plano.antes,
        cobre=plano.cobre,
        folga_pct=plano.folga_pct,
        folga_padrao_pct=restaurante.folga_compra_pct,
        comprar=[
            LinhaCompraSaida(
                insumo_id=i.insumo.id,
                nome=i.insumo.nome,
                unidade=i.insumo.unidade,
                onde_compra=i.insumo.onde_compra,
                embalagem_quantidade=i.insumo.embalagem_quantidade,
                embalagem_nome=i.insumo.embalagem_nome,
                tem=i.linha.tem,
                sai_ate_compra=i.linha.sai_ate_compra,
                sobra=i.linha.sobra,
                precisa=i.linha.precisa,
                com_folga=i.linha.com_folga,
                falta=i.linha.falta,
                embalagens=i.linha.embalagens,
                quantidade=i.linha.quantidade,
                valor_centavos=i.valor_centavos,
                situacao=i.situacao.value,
                acaba_em=i.acaba_em,
                pratos=[
                    PratoNaConta(
                        item_id=p.item_id, nome=p.nome, por_porcao=p.por_porcao, pratos=p.pratos
                    )
                    for p in i.pratos
                ],
            )
            for i in comprar
        ],
        nada_a_comprar=[i.insumo.nome for i in plano.itens if not i.linha.embalagens],
        pratos=[
            PrevisaoDoPratoSaida(
                item_id=p.item_id,
                nome=p.nome,
                noites=[
                    NoiteDoPrato(
                        noite=n.noite,
                        previstos=n.previstos,
                        ultimas=n.ultimas,
                        ja_vendidos=n.ja_vendidos,
                    )
                    for n in p.noites
                ],
            )
            for p in plano.pratos
        ],
        total_centavos=(sum(v for v in valores if v is not None) if None not in valores else None),
    )


@router.post("/insumos", status_code=status.HTTP_201_CREATED, dependencies=[exigir_papel(*GESTAO)])
def criar_insumo(
    dados: InsumoEntrada,
    db: Db,
    usuario: UsuarioAtual,
    restaurante_id: RestauranteAlvo,
    servico: Servico,
) -> InsumoSaida:
    nome = dados.nome.strip()
    repetido = db.scalar(
        select(Insumo.id).where(Insumo.restaurante_id == restaurante_id, Insumo.nome == nome)
    )
    if repetido is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{nome} já está no estoque")
    insumo = Insumo(
        restaurante_id=restaurante_id,
        **dados.model_dump(exclude={"saldo", "nome"}),
        nome=nome,
    )

    def criar() -> Insumo:
        db.add(insumo)
        db.flush()
        if dados.saldo:  # "tem agora": o saldo de partida, que não é sobra nem perda
            servico_estoque.mover(
                db,
                insumo.id,
                restaurante_id,
                TipoMovimento.INICIAL,
                dados.saldo,
                agora(),
                usuario_id=usuario.id,
            )
        return insumo

    return insumo_saida(servico.mexer_no_estoque(db, restaurante_id, criar), usuario)


@router.patch("/insumos/{insumo_id}", dependencies=[exigir_papel(*GESTAO)])
def atualizar_insumo(
    insumo_id: int, dados: InsumoAtualizacao, db: Db, usuario: UsuarioAtual, servico: Servico
) -> InsumoSaida:
    """A unidade não muda depois de criado: o livro inteiro está nela."""
    insumo = _insumo(db, insumo_id, usuario)
    mudancas = dados.model_dump(exclude_unset=True)
    if "nome" in mudancas:
        mudancas["nome"] = mudancas["nome"].strip()

    def atualizar() -> Insumo:
        for campo, valor in mudancas.items():
            setattr(insumo, campo, valor)
        db.flush()
        if "custo_centavos" in mudancas:
            servico_estoque.atualizar_custo_dos_pratos(
                db, insumo.restaurante_id, insumos={insumo.id}
            )
        return insumo

    return insumo_saida(servico.mexer_no_estoque(db, insumo.restaurante_id, atualizar), usuario)


@router.get("/insumos/{insumo_id}/movimentos", dependencies=[exigir_papel(*GESTAO)])
def ver_movimentos(insumo_id: int, db: Db, usuario: UsuarioAtual) -> list[MovimentoSaida]:
    """As últimas linhas do livro deste ingrediente, da mais nova para a mais antiga."""
    insumo = _insumo(db, insumo_id, usuario)
    linhas = db.execute(
        select(MovimentoEstoque, Usuario.nome, ItemPedido.nome)
        .outerjoin(Usuario, MovimentoEstoque.usuario_id == Usuario.id)
        .outerjoin(ItemPedido, MovimentoEstoque.item_pedido_id == ItemPedido.id)
        .where(MovimentoEstoque.insumo_id == insumo.id)
        .order_by(MovimentoEstoque.em.desc(), MovimentoEstoque.id.desc())
        .limit(MOVIMENTOS_NA_TELA)
    ).all()
    return [
        MovimentoSaida(
            id=m.id,
            tipo=m.tipo,
            quantidade=m.quantidade,
            saldo_depois=m.saldo_depois,
            valor_centavos=m.valor_centavos,
            motivo=m.motivo,
            prato=prato,
            quem=quem,
            em=m.em,
        )
        for m, quem, prato in linhas
    ]


@router.post("/compras", status_code=status.HTTP_201_CREATED, dependencies=[exigir_papel(*GESTAO)])
def registrar_compra(
    dados: CompraEntrada, db: Db, usuario: UsuarioAtual, servico: Servico
) -> InsumoSaida:
    insumo = _insumo(db, dados.insumo_id, usuario)
    if not insumo.ativo:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{insumo.nome} saiu do estoque")

    # A nota anterior, para avisar o dono se o preço subiu (o custo médio, se não houver).
    notas = servico_perdas.precos_das_notas(db, insumo, limite=1)
    antes = notas[0][1] if notas else insumo.custo_centavos

    def comprar() -> Insumo:
        servico_estoque.registrar_compra(
            db, insumo, dados.quantidade, dados.valor_centavos, usuario.id, agora()
        )
        return insumo

    saida = insumo_saida(servico.mexer_no_estoque(db, insumo.restaurante_id, comprar), usuario)
    if dados.valor_centavos is not None:
        nota = preco_da_nota(dados.quantidade, dados.valor_centavos, insumo.unidade)
        if (subida := subida_de_preco(antes, nota)) is not None:
            pratos = servico_perdas.pratos_que_encarecem(db, insumo, subida)
            servico.push.enviar(
                insumo.restaurante_id,
                "O preço subiu",
                servico_perdas.texto_do_preco(insumo, subida, pratos),
                (Papel.DONO,),
                url="/estoque",
            )
    return saida


@router.post("/perdas", status_code=status.HTTP_201_CREATED)
def registrar_perda(
    dados: PerdaEntrada, db: Db, usuario: UsuarioAtual, servico: Servico
) -> InsumoSaida:
    """Qualquer um da equipe registra: quem jogou fora sabe o quanto e por quê."""
    insumo = _insumo(db, dados.insumo_id, usuario)

    def perder() -> Insumo:
        servico_estoque.mover(
            db,
            insumo.id,
            insumo.restaurante_id,
            TipoMovimento.PERDA,
            -dados.quantidade,
            agora(),
            motivo=dados.motivo,
            usuario_id=usuario.id,
        )
        return insumo

    return insumo_saida(servico.mexer_no_estoque(db, insumo.restaurante_id, perder), usuario)


@router.post("/contagens", dependencies=[exigir_papel(*GESTAO)])
def registrar_contagem(
    dados: ContagemEntrada,
    db: Db,
    usuario: UsuarioAtual,
    restaurante_id: RestauranteAlvo,
    servico: Servico,
) -> ContagemSaida:
    """O que foi contado substitui a conta. Devolve a diferença de cada ingrediente."""
    contados = {linha.insumo_id: linha.quantidade for linha in dados.itens}
    insumos = {
        i.id: i
        for i in db.scalars(
            select(Insumo).where(
                Insumo.id.in_(list(contados)), Insumo.restaurante_id == restaurante_id
            )
        )
    }
    if len(insumos) != len(contados):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ingrediente não encontrado")

    def contar():
        return servico_estoque.registrar_contagem(db, restaurante_id, contados, usuario.id, agora())

    diferencas = servico.mexer_no_estoque(db, restaurante_id, contar)
    return ContagemSaida(
        diferencas=[
            DiferencaSaida(
                insumo_id=d.insumo_id,
                nome=insumos[d.insumo_id].nome,
                unidade=insumos[d.insumo_id].unidade,
                antes=d.antes,
                contado=d.contado,
                diferenca=d.diferenca,
            )
            for d in diferencas
        ]
    )


@router.get("/perdas", dependencies=[exigir_papel(*VEEM_CUSTO)])
def ver_perdas(
    db: Db,
    restaurante_id: RestauranteAlvo,
    periodo: Annotated[Literal["semana", "mes"], Query()] = "semana",
) -> PerdasSaida:
    """Custo pela ficha contra o custo de verdade, o que escapou e onde. Só o dono: são
    valores em reais do custo."""
    restaurante = db.get_one(Restaurante, restaurante_id)
    r = servico_perdas.relatorio_de_perdas(db, restaurante, Periodo(periodo), agora())
    return PerdasSaida(
        periodo=periodo,
        primeira_noite=r.primeira_noite,
        ultima_noite=r.ultima_noite,
        vendeu_centavos=r.vendeu_centavos,
        custo_pela_ficha_centavos=r.custo_pela_ficha_centavos,
        custo_de_verdade_centavos=r.custo_de_verdade_centavos,
        escapou_centavos=r.escapou_centavos,
        registrada_centavos=r.registrada_centavos,
        sem_registro_centavos=r.sem_registro_centavos,
        itens_sem_custo=r.itens_sem_custo,
        ultima_contagem=r.ultima_contagem,
        linhas=[
            LinhaPerdaSaida(
                insumo_id=linha.insumo.id,
                nome=linha.insumo.nome,
                unidade=linha.insumo.unidade,
                pela_ficha=linha.perda.pela_ficha,
                registrada=linha.perda.registrada,
                sem_registro=linha.perda.sem_registro,
                saiu=linha.perda.saiu,
                escapou=linha.perda.escapou,
                valor_escapou_centavos=linha.valor_escapou,
                valor_sem_registro_centavos=linha.valor_sem_registro,
                curva=r.curva.get(linha.insumo.id),
                prato=linha.prato,
                por_porcao=linha.por_porcao,
            )
            for linha in r.linhas
        ],
        por_motivo=[
            PerdaPorMotivoSaida(
                motivo=m.motivo,
                valor_centavos=m.valor_centavos,
                itens=[
                    ItemPerdidoSaida(nome=i.nome, unidade=i.unidade, quantidade=q)
                    for i, q in m.itens
                ],
            )
            for m in r.por_motivo
        ],
        precos=[
            PrecoQueSubiuSaida(
                insumo_id=p.insumo.id,
                nome=p.insumo.nome,
                unidade=p.insumo.unidade,
                antes_centavos=p.subida.antes_centavos,
                agora_centavos=p.subida.agora_centavos,
                pct=p.subida.pct,
                em=p.em,
                pratos=[PratoMaisCaroSaida(nome=n, a_mais_centavos=v) for n, v in p.pratos],
            )
            for p in r.precos
        ],
        curva_a=[
            i.nome for i in servico_perdas.ingredientes_da_curva(db, restaurante_id, r.curva, "A")
        ],
    )
