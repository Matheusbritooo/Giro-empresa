"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Aviso, Esqueleto } from "@/components/ui";
import { api } from "@/lib/api";
import { type Conexao, useRelogio, useSalaoAoVivo } from "@/lib/ao-vivo";
import { prepararSom, tocarAlerta } from "@/lib/avisos";
import { useDados } from "@/lib/dados";
import { type Lancamento, lancamentosDaCozinha } from "@/lib/pedido";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { comBusca, horaLocal } from "@/lib/resultados";
import { horaCurta, minutosEntre } from "@/lib/salao";
import { useTelaAcesa } from "@/lib/tela-acesa";
import type { AvisoAoVivo, ItemCozinha } from "@/lib/tipos";

/** Passou disso desde o lançamento, o pedido fica em destaque: a mesa está esperando. */
const MINUTOS_ATRASADO = 20;
/** Se a conexão ao vivo falhar, a fila ainda se atualiza sozinha. */
const ATUALIZAR_MS = 30_000;

function semAlerta() {}

export default function PaginaCozinha() {
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
  const caminho = usePathname();
  const router = useRouter();
  // Modo TV: tela cheia, letra grande, tela que não apaga e um toque a cada pedido novo.
  // Fica na URL (?tv=1) para a TV da cozinha abrir direto nele.
  const tv = parametros.get("tv") === "1";
  const telaAcesa = useTelaAcesa(tv);
  const buscar = useCallback(
    () => api<ItemCozinha[]>("/api/cozinha", { restaurante }),
    [restaurante],
  );
  const {
    dados: fila,
    erro,
    recarregar,
  } = useDados(restaurante ? buscar : null, `cozinha:${restaurante}`);
  const aoAviso = useCallback(
    (aviso: AvisoAoVivo) => aviso.tipo !== "estoque" && recarregar(),
    [recarregar],
  );
  const { estado, conexao } = useSalaoAoVivo(restaurante, semAlerta, aoAviso);
  const agora = useRelogio(estado.ajusteRelogioMs);
  const [saindo, setSaindo] = useState<Set<number>>(new Set());
  const [recado, setRecado] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(recarregar, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [recarregar]);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;

  async function pronto(item: ItemCozinha) {
    setSaindo((s) => new Set(s).add(item.id));
    try {
      await api(`/api/pedidos/${item.id}/pronto`, { metodo: "POST" });
      recarregar();
    } catch (e) {
      setRecado((e as Error).message);
      setSaindo((s) => {
        const novo = new Set(s);
        novo.delete(item.id);
        return novo;
      });
    }
  }

  const lancamentos = lancamentosDaCozinha((fila ?? []).filter((i) => !saindo.has(i.id)));

  function entrarNoModoTv() {
    prepararSom(); // o toque no botão libera o som para avisar dos pedidos novos
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    router.replace(comBusca(caminho, parametros, { tv: "1" }), { scroll: false });
  }

  function sairDoModoTv() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    router.replace(comBusca(caminho, parametros, { tv: null }), { scroll: false });
  }

  if (tv) {
    return (
      <ModoTv
        lancamentos={lancamentos}
        carregou={!!fila}
        agora={agora}
        conexao={conexao}
        telaAcesa={telaAcesa}
        recado={erro ?? recado}
        aoPronto={pronto}
        aoSair={sairDoModoTv}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-placa text-4xl font-extrabold leading-none">Cozinha</h1>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-sm font-semibold" role="status">
            <span
              aria-hidden
              className={`size-2.5 rounded-full ${conexao === "ao_vivo" ? "bg-ocupada" : "bg-aguardando"}`}
            />
            {conexao === "ao_vivo" ? "Ao vivo" : "Reconectando..."}
          </span>
          <Link
            href={comBusca("/cardapio", parametros, {})}
            className="text-sm font-semibold underline underline-offset-4"
          >
            Marcar o que acabou
          </Link>
          <button
            type="button"
            onClick={entrarNoModoTv}
            className="min-h-10 rounded-lg border border-linha bg-superficie px-3 text-sm font-semibold hover:border-tinta-suave"
          >
            Modo TV
          </button>
        </div>
      </div>
      <Aviso>{erro ?? recado}</Aviso>

      {!fila ? (
        !erro && <Esqueleto rotulo="Abrindo a fila" />
      ) : lancamentos.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-linha p-6">
          <p className="font-semibold">Nada na fila.</p>
          <p className="text-tinta-suave">
            Os pedidos que os garçons lançarem aparecem aqui na hora.
          </p>
        </div>
      ) : (
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Pedidos para fazer">
          {lancamentos.map((l) => {
            const minutos = minutosEntre(l.lancadoEm, agora);
            const atrasado = minutos >= MINUTOS_ATRASADO;
            return (
              <li
                key={l.chave}
                data-testid={`lancamento-mesa-${l.mesaNumero}`}
                className={`flex flex-col gap-3 rounded-2xl border bg-superficie p-4 ${
                  atrasado ? "border-2 border-atrasada" : "border-linha"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-placa text-3xl font-extrabold leading-none">
                    Mesa {l.mesaNumero}
                  </h2>
                  <span
                    className={`numeros text-sm ${atrasado ? "font-bold text-atrasada" : "text-tinta-suave"}`}
                  >
                    {horaCurta(l.lancadoEm)}, há {minutos} min{atrasado ? " (atrasado)" : ""}
                  </span>
                </div>
                <ul className="flex flex-col divide-y divide-linha">
                  {l.itens.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-2">
                      <span className="numeros font-placa text-2xl font-extrabold">
                        {item.quantidade}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold">{item.nome}</span>
                        {item.observacao && (
                          <span className="text-sm font-semibold text-atrasada">
                            {item.observacao}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => pronto(item)}
                        aria-label={`${item.nome} da mesa ${l.mesaNumero} pronto`}
                        className="min-h-11 shrink-0 rounded-lg bg-tinta px-4 font-semibold text-fundo hover:opacity-90"
                      >
                        Pronto
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/** A fila da cozinha para a TV da parede: tela cheia por cima do painel, letra de longe. */
function ModoTv({
  lancamentos,
  carregou,
  agora,
  conexao,
  telaAcesa,
  recado,
  aoPronto,
  aoSair,
}: {
  lancamentos: Lancamento[];
  carregou: boolean;
  agora: number;
  conexao: Conexao;
  telaAcesa: boolean;
  recado: string | null;
  aoPronto: (item: ItemCozinha) => void;
  aoSair: () => void;
}) {
  // Um toque a cada lançamento novo (o primeiro desenho da fila não toca).
  const vistos = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!carregou) return;
    const chaves = new Set(lancamentos.map((l) => l.chave));
    const novo = vistos.current !== null && [...chaves].some((c) => !vistos.current?.has(c));
    vistos.current = chaves;
    if (novo) tocarAlerta();
  }, [lancamentos, carregou]);

  const itens = lancamentos.reduce(
    (soma, l) => soma + l.itens.reduce((s, i) => s + i.quantidade, 0),
    0,
  );
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col gap-4 overflow-y-auto bg-fundo p-4 sm:p-6"
      data-testid="modo-tv"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-4">
          <h1 className="font-placa text-5xl font-extrabold leading-none">Cozinha</h1>
          <span className="numeros font-placa text-4xl font-bold text-tinta-suave">
            {horaLocal(agora)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xl font-semibold" role="status">
            {itens === 0 ? "Fila vazia" : `${itens} ${itens === 1 ? "item" : "itens"} na fila`}
          </span>
          <span className="flex items-center gap-2 text-lg font-semibold" role="status">
            <span
              aria-hidden
              className={`size-3 rounded-full ${conexao === "ao_vivo" ? "bg-ocupada" : "bg-aguardando"}`}
            />
            {conexao === "ao_vivo" ? "Ao vivo" : "Sem conexão"}
          </span>
          <button
            type="button"
            onClick={aoSair}
            className="min-h-11 rounded-lg border border-linha bg-superficie px-4 font-semibold"
          >
            Sair do modo TV
          </button>
        </div>
      </header>
      {!telaAcesa && (
        <p className="text-tinta-suave">
          Este aparelho não deixa o GIRO manter a tela acesa. Desligue o descanso de tela nas
          configurações da TV.
        </p>
      )}
      {recado && (
        <p
          role="alert"
          className="rounded-lg border-l-4 border-atrasada bg-superficie px-4 py-2 text-lg"
        >
          {recado}
        </p>
      )}
      {lancamentos.length === 0 ? (
        <p className="grid flex-1 place-items-center font-placa text-4xl font-bold text-tinta-suave">
          Nada na fila
        </p>
      ) : (
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Pedidos para fazer">
          {lancamentos.map((l) => {
            const minutos = minutosEntre(l.lancadoEm, agora);
            const atrasado = minutos >= MINUTOS_ATRASADO;
            return (
              <li
                key={l.chave}
                data-testid={`tv-mesa-${l.mesaNumero}`}
                className={`flex flex-col gap-3 rounded-2xl bg-superficie p-5 ${
                  atrasado ? "border-4 border-atrasada" : "border-2 border-linha"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-placa text-6xl font-extrabold leading-none">
                    Mesa {l.mesaNumero}
                  </h2>
                  <span
                    className={`numeros text-2xl font-bold ${atrasado ? "text-atrasada" : "text-tinta-suave"}`}
                  >
                    {minutos} min{atrasado ? ", atrasado" : ""}
                  </span>
                </div>
                <ul className="flex flex-col divide-y divide-linha">
                  {l.itens.map((item) => (
                    <li key={item.id} className="flex items-center gap-4 py-3">
                      <span className="numeros font-placa text-5xl font-extrabold">
                        {item.quantidade}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-2xl font-semibold leading-tight">{item.nome}</span>
                        {item.observacao && (
                          <span className="text-xl font-bold text-atrasada">{item.observacao}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => aoPronto(item)}
                        aria-label={`${item.nome} da mesa ${l.mesaNumero} pronto`}
                        className="min-h-14 shrink-0 rounded-xl bg-tinta px-6 text-xl font-bold text-fundo"
                      >
                        Pronto
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
