import { useSyncExternalStore } from "react";

/** Acompanha uma media query do navegador (tema escuro, movimento reduzido...). */
function useMidia(consulta: string, noServidor = false): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const lista = window.matchMedia(consulta);
      lista.addEventListener("change", avisar);
      return () => lista.removeEventListener("change", avisar);
    },
    () => window.matchMedia(consulta).matches,
    () => noServidor,
  );
}

export function useTemaEscuro(): boolean {
  return useMidia("(prefers-color-scheme: dark)");
}

export function useMovimentoReduzido(): boolean {
  return useMidia("(prefers-reduced-motion: reduce)");
}
