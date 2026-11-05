"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { ContaDaMesa } from "@/components/detalhe-mesa";
import { Aviso, Botao } from "@/components/ui";
import { api, ErroApi } from "@/lib/api";
import { useSalaoAoVivo } from "@/lib/ao-vivo";
import { useDados } from "@/lib/dados";
import {
  adicionar,
  type Filtro,
  itensParaEscolher,
  type LinhaRascunho,
  preco,
  quantidadeNoRascunho,
  situacaoDoItem,
  tirar,
  totalDoRascunho,
} from "@/lib/pedido";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { comBusca } from "@/lib/resultados";
import { horaCurta } from "@/lib/salao";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import {
  type AvisoAoVivo,
  type Cardapio,
  type ItemCardapio,
  type ItemPedido,
  MOTIVOS_CANCELAMENTO,
  type PedidoMesa,
} from "@/lib/tipos";

const ESTADO: Record<string, string> = {
  livre: "Livre",
  aguardando: "Esperando atendimento",
  ocupada: "Ocupada",
  para_limpar: "Para limpar",
};

function semAlerta() {}

export default function PaginaPedido() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
  const mesaId = Number(parametros.get("mesa"));
  const gestao = !!sessao && podeGerirMesas(sessao.usuario.papel);

  const buscarCardapio = useCallback(
    () => api<Cardapio>("/api/cardapio", { restaurante }),
    [restaurante],
  );
  const buscarPedido = useCallback(() => api<PedidoMesa>(`/api/mesas/${mesaId}/pedido`), [mesaId]);
  const cardapio = useDados(restaurante ? buscarCardapio : null);
  const pedido = useDados(mesaId > 0 ? buscarPedido : null);
  const recarregarCardapio = cardapio.recarregar;
  const recarregarPedido = pedido.recarregar;

  // Outro garçom lançou, a cozinha marcou pronto ou algo acabou: busca de novo.
  const aoAviso = useCallback(
    (aviso: AvisoAoVivo) => {
      if (aviso.tipo === "cardapio") recarregarCardapio();
      else if (aviso.tipo === "pedido" && aviso.mesa_id === mesaId) recarregarPedido();
    },
    [mesaId, recarregarCardapio, recarregarPedido],
  );
  useSalaoAoVivo(restaurante, semAlerta, aoAviso);

  const [rascunho, setRascunho] = useState<LinhaRascunho[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("mais");
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const [cancelando, setCancelando] = useState<number | null>(null);
  const [obsAberta, setObsAberta] = useState<number | null>(null);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  if (!(mesaId > 0)) return <Aviso>Escolha a mesa no salão.</Aviso>;

  const voltar = comBusca("/salao", parametros, { mesa: null });
  const erro = cardapio.erro ?? pedido.erro;
  if (!cardapio.dados || !pedido.dados) {
    return erro ? <Aviso>{erro}</Aviso> : <p className="text-tinta-suave">Abrindo o pedido...</p>;
  }

  const { mesa, itens: jaPedidos, total_centavos } = pedido.dados;
  const menu = cardapio.dados;
  const porId = new Map(menu.itens.map((i) => [i.id, i]));
  const escolher = itensParaEscolher(menu, filtro, busca);
  const naCozinha = jaPedidos.filter((i) => situacaoDoItem(i) === "na_cozinha").length;
  const qtdRascunho = quantidadeNoRascunho(rascunho);
  const categorias = menu.categorias.filter((c) => c.ativa);

  async function lancar() {
    if (enviando || rascunho.length === 0) return;
    setEnviando(true);
    setRecado(null);
    try {
      await api<PedidoMesa>(`/api/mesas/${mesaId}/pedidos`, {
        metodo: "POST",
        corpo: {
          itens: rascunho.map((l) => ({
            item_id: l.itemId,
            quantidade: l.quantidade,
            observacao: l.observacao.trim() || null,
          })),
        },
      });
      setRascunho([]);
      setObsAberta(null);
      setRecado({ tipo: "ok", texto: `Pedido da mesa ${mesa.numero} lançado.` });
      recarregarPedido();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
      // "Lasanha acabou": o cardápio mudou desde que a tela abriu.
      if (e instanceof ErroApi && e.status === 409) recarregarCardapio();
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar(item: ItemPedido, motivo: string) {
    try {
      await api(`/api/pedidos/${item.id}/cancelar`, { metodo: "POST", corpo: { motivo } });
      setCancelando(null);
      setRecado({ tipo: "ok", texto: `${item.nome} cancelado.` });
      recarregarPedido();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  async function pedirConta(_mesa: { id: number }, pedida: boolean) {
    try {
      await api(`/api/mesas/${mesaId}/conta`, { metodo: "POST", corpo: { pedida } });
      setRecado({
        tipo: "ok",
        texto: pedida
          ? `Mesa ${mesa.numero} pediu a conta.`
          : `Conta da mesa ${mesa.numero} desfeita.`,
      });
      recarregarPedido();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  function escolherFiltro(novo: Filtro) {
    setFiltro(novo);
    setBusca("");
  }

  function mudarObservacao(itemId: number, observacao: string) {
    setRascunho((atual) => atual.map((l) => (l.itemId === itemId ? { ...l, observacao } : l)));
  }

  return (
    <>
      <Link href={voltar} className="self-start font-semibold text-tinta-suave hover:text-tinta">
        <span aria-hidden>‹ </span>Salão
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="font-placa text-5xl font-extrabold leading-none">Mesa {mesa.numero}</h1>
        <p className="text-tinta-suave" data-testid="estado-mesa">
          {ESTADO[mesa.estado] ?? mesa.estado}
          {mesa.sentou_em && mesa.estado !== "livre" ? `, desde ${horaCurta(mesa.sentou_em)}` : ""}
        </p>
      </header>

      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      {mesa.estado === "livre" && (
        <p className="rounded-lg border border-dashed border-linha px-3 py-2 text-sm text-tinta-suave">
          A mesa está livre. Lançar o pedido já conta a mesa como ocupada e atendida.
        </p>
      )}

      {/* No celular o novo pedido fica preso embaixo: sobra espaço para ele não cobrir nada. */}
      <div
        className={`grid items-start gap-6 lg:grid-cols-[1fr_24rem] lg:pb-0 ${rascunho.length ? "pb-[60vh]" : "pb-36"}`}
      >
        <section aria-labelledby="titulo-escolher" className="flex min-w-0 flex-col gap-3">
          <h2 id="titulo-escolher" className="sr-only">
            Escolher itens
          </h2>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Buscar no cardápio
            <input
              id="busca-cardapio"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Ex.: lasanha"
              className="min-h-11 rounded-lg border border-linha bg-superficie px-3 text-base font-normal"
            />
          </label>
          <div
            role="group"
            aria-label="Mostrar"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            <Chip ativo={filtro === "mais" && !busca} aoTocar={() => escolherFiltro("mais")}>
              Mais pedidos
            </Chip>
            {categorias.map((c) => (
              <Chip
                key={c.id}
                ativo={filtro === c.id && !busca}
                aoTocar={() => escolherFiltro(c.id)}
              >
                {c.nome}
              </Chip>
            ))}
          </div>
          {escolher.length === 0 ? (
            <p className="text-tinta-suave">
              {busca ? `Nada no cardápio com "${busca}".` : "Nenhum item aqui ainda."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {escolher.map((item) => (
                <li key={item.id}>
                  <BotaoItem
                    item={item}
                    quantidade={rascunho.find((l) => l.itemId === item.id)?.quantidade ?? 0}
                    aoTocar={() => setRascunho((r) => adicionar(r, item.id))}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-6 lg:sticky lg:top-4">
          <Rascunho
            className="fixed inset-x-0 bottom-0 z-20 max-h-[55vh] overflow-y-auto border-t-2 border-tinta bg-superficie px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-[0_-8px_24px_rgb(0_0_0/0.12)] lg:static lg:max-h-none lg:rounded-2xl lg:border-2 lg:p-4 lg:shadow-none"
            mesaNumero={mesa.numero}
            rascunho={rascunho}
            porId={porId}
            quantidade={qtdRascunho}
            total={totalDoRascunho(rascunho, menu.itens)}
            enviando={enviando}
            obsAberta={obsAberta}
            aoAbrirObs={setObsAberta}
            aoMudarObs={mudarObservacao}
            aoMais={(id) => setRascunho((r) => adicionar(r, id))}
            aoMenos={(id) => setRascunho((r) => tirar(r, id))}
            aoLancar={lancar}
          />

          <section aria-labelledby="titulo-ja-pedido" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="titulo-ja-pedido" className="font-placa text-2xl font-bold">
                Já pedido
              </h2>
              {naCozinha > 0 && (
                <span className="text-sm text-tinta-suave">
                  {naCozinha} {naCozinha === 1 ? "item" : "itens"} na cozinha
                </span>
              )}
            </div>
            {jaPedidos.length === 0 ? (
              <p className="text-tinta-suave">Nada lançado nessa visita ainda.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-linha rounded-xl border border-linha bg-superficie px-3">
                {jaPedidos.map((item) => (
                  <LinhaPedida
                    key={item.id}
                    item={item}
                    gestao={gestao}
                    cancelando={cancelando === item.id}
                    aoPedirCancelar={() => setCancelando(item.id)}
                    aoDesistir={() => setCancelando(null)}
                    aoCancelar={(motivo) => cancelar(item, motivo)}
                  />
                ))}
              </ul>
            )}
            <div className="flex items-baseline justify-between border-t-2 border-tinta pt-2 font-bold">
              <span>Total da mesa</span>
              <span className="numeros font-placa text-3xl font-extrabold" data-testid="total-mesa">
                {preco(total_centavos)}
              </span>
            </div>
            {!gestao && jaPedidos.length > 0 && (
              <p className="text-sm text-tinta-suave">Para cancelar um item, chame o gerente.</p>
            )}
            {mesa.estado === "ocupada" && <ContaDaMesa mesa={mesa} aoPedirConta={pedirConta} />}
          </section>
        </div>
      </div>
    </>
  );
}

function Chip({
  ativo,
  aoTocar,
  children,
}: {
  ativo: boolean;
  aoTocar: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={aoTocar}
      className={`min-h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${
        ativo ? "border-tinta bg-tinta text-fundo" : "border-linha bg-superficie text-tinta-suave"
      }`}
    >
      {children}
    </button>
  );
}

function BotaoItem({
  item,
  quantidade,
  aoTocar,
}: {
  item: ItemCardapio;
  quantidade: number;
  aoTocar: () => void;
}) {
  const acabou = !item.disponivel;
  return (
    <button
      type="button"
      onClick={aoTocar}
      disabled={acabou}
      aria-label={`${item.nome}, ${acabou ? "acabou" : preco(item.preco_centavos)}${quantidade ? `, ${quantidade} no pedido` : ""}`}
      className={`relative flex h-full min-h-[4.5rem] w-full flex-col justify-between gap-1 rounded-xl border p-3 text-left transition active:scale-[0.98] ${
        acabou
          ? "cursor-not-allowed border-dashed border-linha text-tinta-suave"
          : quantidade
            ? "border-2 border-ocupada bg-superficie"
            : "border-linha bg-superficie hover:border-tinta-suave"
      }`}
    >
      <span className={`pr-6 font-semibold leading-tight ${acabou ? "line-through" : ""}`}>
        {item.nome}
      </span>
      <span className="numeros text-sm text-tinta-suave">
        {acabou ? (
          <span className="font-bold text-atrasada">Acabou</span>
        ) : (
          preco(item.preco_centavos)
        )}
      </span>
      {quantidade > 0 && (
        <span
          aria-hidden
          className="numeros absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-ocupada font-bold text-sobre-cor"
        >
          {quantidade}
        </span>
      )}
    </button>
  );
}

function Rascunho({
  className,
  mesaNumero,
  rascunho,
  porId,
  quantidade,
  total,
  enviando,
  obsAberta,
  aoAbrirObs,
  aoMudarObs,
  aoMais,
  aoMenos,
  aoLancar,
}: {
  className: string;
  mesaNumero: number;
  rascunho: LinhaRascunho[];
  porId: Map<number, ItemCardapio>;
  quantidade: number;
  total: number;
  enviando: boolean;
  obsAberta: number | null;
  aoAbrirObs: (id: number | null) => void;
  aoMudarObs: (id: number, texto: string) => void;
  aoMais: (id: number) => void;
  aoMenos: (id: number) => void;
  aoLancar: () => void;
}) {
  return (
    <section aria-labelledby="titulo-novo-pedido" className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="titulo-novo-pedido" className="font-semibold">
          Novo pedido da mesa {mesaNumero}
        </h2>
        <span className="numeros text-sm text-tinta-suave">
          {quantidade
            ? `${quantidade} ${quantidade === 1 ? "item" : "itens"}, ${preco(total)}`
            : "toque nos itens"}
        </span>
      </div>
      {rascunho.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="rascunho">
          {rascunho.map((linha) => {
            const item = porId.get(linha.itemId);
            if (!item) return null;
            return (
              <li key={linha.itemId} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => aoMenos(linha.itemId)}
                    aria-label={`Um ${item.nome} a menos`}
                    className="grid size-9 shrink-0 place-items-center rounded-lg border border-linha text-lg font-bold"
                  >
                    −
                  </button>
                  <span className="numeros w-6 text-center font-placa text-xl font-extrabold">
                    {linha.quantidade}
                  </span>
                  <button
                    type="button"
                    onClick={() => aoMais(linha.itemId)}
                    aria-label={`Um ${item.nome} a mais`}
                    className="grid size-9 shrink-0 place-items-center rounded-lg border border-linha text-lg font-bold"
                  >
                    +
                  </button>
                  <span className="min-w-0 flex-1 truncate">{item.nome}</span>
                  <button
                    type="button"
                    onClick={() => aoAbrirObs(obsAberta === linha.itemId ? null : linha.itemId)}
                    className="shrink-0 text-sm font-semibold text-tinta-suave underline underline-offset-2"
                  >
                    {linha.observacao ? "Obs. ✓" : "Obs."}
                  </button>
                </div>
                {obsAberta === linha.itemId && (
                  <input
                    id={`obs-${linha.itemId}`}
                    value={linha.observacao}
                    maxLength={80}
                    onChange={(e) => aoMudarObs(linha.itemId, e.target.value)}
                    placeholder="Para a cozinha. Ex.: sem cebola"
                    aria-label={`Observação de ${item.nome} para a cozinha`}
                    className="min-h-10 rounded-lg border border-linha bg-fundo px-3 text-base"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Botao onClick={aoLancar} disabled={enviando || quantidade === 0} className="w-full text-lg">
        {enviando ? "Lançando..." : "Lançar pedido"}
      </Botao>
    </section>
  );
}

function LinhaPedida({
  item,
  gestao,
  cancelando,
  aoPedirCancelar,
  aoDesistir,
  aoCancelar,
}: {
  item: ItemPedido;
  gestao: boolean;
  cancelando: boolean;
  aoPedirCancelar: () => void;
  aoDesistir: () => void;
  aoCancelar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState<string>(MOTIVOS_CANCELAMENTO[0]);
  const situacao = situacaoDoItem(item);
  const cancelado = situacao === "cancelado";
  return (
    <li className="flex flex-col gap-2 py-3" data-situacao={situacao}>
      <div className="flex items-baseline gap-3">
        <span
          className={`numeros font-placa text-xl font-extrabold ${cancelado ? "text-tinta-suave line-through" : ""}`}
        >
          {item.quantidade}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cancelado ? "text-tinta-suave line-through" : "font-semibold"}>
            {item.nome}
          </span>
          {item.observacao && <span className="text-sm text-tinta-suave">{item.observacao}</span>}
          <span className="text-xs text-tinta-suave">
            {horaCurta(item.lancado_em)}
            {cancelado ? `, cancelado: ${item.motivo_cancelamento}` : ""}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span
            className={`numeros ${cancelado ? "text-tinta-suave line-through" : "font-semibold"}`}
          >
            {preco(item.quantidade * item.preco_unit_centavos)}
          </span>
          {!cancelado && <Selo situacao={situacao} />}
        </span>
      </div>
      {gestao && !cancelado && !cancelando && (
        <button
          type="button"
          onClick={aoPedirCancelar}
          className="self-start text-sm font-semibold text-atrasada underline underline-offset-2"
        >
          Cancelar item
        </button>
      )}
      {cancelando && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Motivo
            <select
              id={`motivo-${item.id}`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="min-h-11 rounded-lg border border-linha bg-superficie px-2 text-base font-normal"
            >
              {MOTIVOS_CANCELAMENTO.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <Botao variante="perigo" onClick={() => aoCancelar(motivo)}>
            Cancelar item
          </Botao>
          <Botao variante="secundario" onClick={aoDesistir}>
            Voltar
          </Botao>
        </div>
      )}
    </li>
  );
}

function Selo({ situacao }: { situacao: "na_cozinha" | "pronto" }) {
  return situacao === "pronto" ? (
    <span className="rounded-full bg-ocupada px-2 py-0.5 text-xs font-bold text-sobre-cor">
      Pronto
    </span>
  ) : (
    <span className="rounded-full bg-aguardando px-2 py-0.5 text-xs font-bold text-sobre-aguardando">
      Na cozinha
    </span>
  );
}
