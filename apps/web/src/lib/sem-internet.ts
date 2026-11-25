// O painel abrindo sem internet (public/sw.js): liga o service worker em produção, guarda o
// último salão (que chega pelo canal ao vivo, onde o service worker não vê) e apaga os dados
// guardados no aparelho quando alguém entra ou sai da conta.

import { urlDaApi } from "./api";
import type { Salao } from "./tipos";

/** O nome do cache de dados do service worker (sessão, salão, cardápio, pedido da mesa). */
export const CACHE_DE_DADOS = "giro-dados";

export function ligarSemInternet(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
}

/** Quem entra ou sai não deixa no aparelho o que a conta anterior viu. */
export async function apagarDadosGuardados(): Promise<void> {
  try {
    await globalThis.caches?.delete(CACHE_DE_DADOS);
  } catch {
    // sem acesso ao cache (navegação privada): não havia nada guardado
  }
}

/** Guarda o salão como se fosse a resposta de GET /api/salao: é o que o painel usa para
 * achar a mesa quando abre sem internet. Só com o service worker no comando (produção). */
export async function guardarSalao(restaurante: number, salao: Salao): Promise<void> {
  if (!navigator.serviceWorker?.controller) return;
  try {
    const cache = await caches.open(CACHE_DE_DADOS);
    await cache.put(
      urlDaApi("/api/salao", restaurante),
      new Response(JSON.stringify(salao), { headers: { "content-type": "application/json" } }),
    );
  } catch {
    // sem espaço ou sem acesso ao cache: o painel só não abre o salão sem internet
  }
}
