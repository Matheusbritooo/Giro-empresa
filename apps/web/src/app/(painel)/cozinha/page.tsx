"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Aviso, Esqueleto } from "@/components/ui";
import { api } from "@/lib/api";
import { useRelogio, useSalaoAoVivo } from "@/lib/ao-vivo";
import { useDados } from "@/lib/dados";
import { lancamentosDaCozinha } from "@/lib/pedido";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { comBusca } from "@/lib/resultados";
import { horaCurta, minutosEntre } from "@/lib/salao";
import type { AvisoAoVivo, ItemCozinha } from "@/lib/tipos";

/** Passou disso desde o lançamento, o pedido fica em destaque: a mesa está esperando. */
const MINUTOS_ATRASADO = 20;
/** Se a conexão ao vivo falhar, a fila ainda se atualiza sozinha. */
const ATUALIZAR_MS = 30_000;

function semAlerta() {}

export default function PaginaCozinha() {
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
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
