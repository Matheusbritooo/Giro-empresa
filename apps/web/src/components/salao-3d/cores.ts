import { useMemo } from "react";

import { useTemaEscuro } from "@/lib/midia";
import type { Tom } from "@/lib/salao";

export type CoresDoSalao = Record<Tom, string> & { foco: string };

// Mesmos valores de globals.css, para o caso raro de a variável não estar disponível.
const RESERVA: Record<"claro" | "escuro", CoresDoSalao> = {
  claro: {
    livre: "#8a958f",
    aguardando: "#c98f12",
    atrasada: "#d2462e",
    ocupada: "#2f5da8",
    limpar: "#7a3e8e",
    foco: "#2f5da8",
  },
  escuro: {
    livre: "#7f8c86",
    aguardando: "#e0a82e",
    atrasada: "#ef6a50",
    ocupada: "#6d95dd",
    limpar: "#b27ac4",
    foco: "#8fb2ee",
  },
};

function lerCores(escuro: boolean): CoresDoSalao {
  const reserva = RESERVA[escuro ? "escuro" : "claro"];
  const estilo = getComputedStyle(document.documentElement);
  const ler = (nome: keyof CoresDoSalao) =>
    estilo.getPropertyValue(`--${nome}`).trim() || reserva[nome];
  return {
    livre: ler("livre"),
    aguardando: ler("aguardando"),
    atrasada: ler("atrasada"),
    ocupada: ler("ocupada"),
    limpar: ler("limpar"),
    foco: ler("foco"),
  };
}

/** As cores dos estados vêm dos tokens do painel: a mesa no 3D tem a mesma cor da planta. */
export function useCoresDoSalao(): CoresDoSalao {
  const escuro = useTemaEscuro();
  return useMemo(() => lerCores(escuro), [escuro]);
}
