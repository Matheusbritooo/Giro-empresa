// "Esconder os primeiros passos": vale só neste aparelho (é uma conveniência de tela, não um
// dado do restaurante). Sem acesso ao armazenamento do navegador, a lista simplesmente aparece.

import { useCallback, useSyncExternalStore } from "react";

const EVENTO = "giro:passos";
const chave = (restaurante: number) => `giro:passos-ocultos:${restaurante}`;

function ler(restaurante: number | null): boolean {
  if (!restaurante) return false;
  try {
    return localStorage.getItem(chave(restaurante)) === "1";
  } catch {
    return false;
  }
}

function ouvir(avisar: () => void) {
  window.addEventListener("storage", avisar);
  window.addEventListener(EVENTO, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(EVENTO, avisar);
  };
}

export function usePassosOcultos(
  restaurante: number | null,
): [boolean, (ocultos: boolean) => void] {
  const ocultos = useSyncExternalStore(
    ouvir,
    () => ler(restaurante),
    () => false,
  );
  const mudar = useCallback(
    (valor: boolean) => {
      if (!restaurante) return;
      try {
        if (valor) localStorage.setItem(chave(restaurante), "1");
        else localStorage.removeItem(chave(restaurante));
      } catch {
        // sem armazenamento: continua aparecendo, sem problema
      }
      window.dispatchEvent(new Event(EVENTO));
    },
    [restaurante],
  );
  return [ocultos, mudar];
}
