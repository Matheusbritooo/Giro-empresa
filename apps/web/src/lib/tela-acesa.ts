"use client";

import { useEffect, useSyncExternalStore } from "react";

const semMudanca = () => () => {};

/**
 * Pede ao aparelho para não apagar a tela enquanto `ligada` (TV da cozinha). O navegador
 * solta o pedido quando a aba some; ao voltar, pede de novo. Sem suporte (navegador antigo
 * ou página sem https), devolve false e a tela fica como o aparelho mandar.
 */
export function useTelaAcesa(ligada: boolean): boolean {
  // No servidor não dá para saber: supõe que sim, para não mostrar o aviso à toa.
  const suportado = useSyncExternalStore(
    semMudanca,
    () => "wakeLock" in navigator,
    () => true,
  );

  useEffect(() => {
    if (!ligada || !suportado) return;
    let trava: WakeLockSentinel | null = null;
    let ativo = true;
    const pedir = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((t) => {
          if (ativo) trava = t;
          else void t.release();
        })
        .catch(() => undefined); // bateria fraca, aba escondida: tenta de novo na volta
    };
    pedir();
    document.addEventListener("visibilitychange", pedir);
    return () => {
      ativo = false;
      document.removeEventListener("visibilitychange", pedir);
      void trava?.release();
    };
  }, [ligada, suportado]);

  return suportado;
}
