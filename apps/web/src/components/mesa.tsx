"use client";

import { situacao, tempoDecorrido, type Tom } from "@/lib/salao";
import type { Mesa } from "@/lib/tipos";

// Cor de fundo e do texto de cada estado. Livre fica só no contorno tracejado: quieta.
const ESTILO_MESA: Record<Tom, string> = {
  livre: "border-2 border-dashed border-livre text-tinta-suave",
  aguardando: "bg-aguardando text-sobre-aguardando",
  atrasada: "bg-atrasada text-sobre-cor chamando",
  ocupada: "bg-ocupada text-sobre-cor",
  limpar: "bg-limpar text-sobre-cor hachurado",
};

export function MesaNaPlanta({
  mesa,
  agoraMs,
  limiteSeg,
  aoAbrir,
}: {
  mesa: Mesa;
  agoraMs: number;
  limiteSeg: number;
  aoAbrir: (mesa: Mesa) => void;
}) {
  const s = situacao(mesa, agoraMs, limiteSeg);
  const cronometro = s.desde ? tempoDecorrido(s.desde, agoraMs) : null;
  const sentados = mesa.estado === "livre" || mesa.estado === "para_limpar" ? 0 : mesa.pessoas;

  return (
    <button
      type="button"
      onClick={() => aoAbrir(mesa)}
      aria-label={`${s.descricao}${cronometro ? `, há ${cronometro}` : ""}`}
      data-estado={s.tom}
      data-testid={`mesa-${mesa.numero}`}
      className="group flex min-w-[76px] flex-col items-stretch gap-1 rounded-xl p-1 text-left"
      style={{ gridColumn: mesa.pos_x + 1, gridRow: mesa.pos_y + 1 }}
    >
      <Cadeiras quantas={Math.ceil(mesa.lugares / 2)} ocupadas={Math.ceil(sentados / 2)} />
      <span
        className={`flex aspect-[5/4] flex-col justify-between rounded-lg px-2 py-1.5 transition-transform group-active:scale-95 ${ESTILO_MESA[s.tom]}`}
      >
        <span className="font-placa text-[2rem] font-extrabold leading-none sm:text-[2.4rem]">
          {mesa.numero}
        </span>
        <span className="flex flex-col leading-tight">
          {cronometro && (
            <span className="numeros text-base font-bold" data-testid="cronometro">
              {cronometro}
            </span>
          )}
          <span className="whitespace-nowrap text-[0.72rem] font-semibold">{s.curto}</span>
        </span>
      </span>
      <Cadeiras quantas={Math.floor(mesa.lugares / 2)} ocupadas={Math.floor(sentados / 2)} />
    </button>
  );
}

function Cadeiras({ quantas, ocupadas }: { quantas: number; ocupadas: number }) {
  return (
    <span aria-hidden className="flex h-2 justify-center gap-1.5">
      {Array.from({ length: Math.min(quantas, 6) }, (_, i) => (
        <span
          key={i}
          className={
            i < ocupadas
              ? "size-2 rounded-full bg-tinta"
              : "size-2 rounded-full border border-tinta-suave/60"
          }
        />
      ))}
    </span>
  );
}

/** Amostra do estado, usada na contagem do topo (que também serve de legenda). */
export function AmostraTom({ tom }: { tom: Tom }) {
  const base = "inline-block size-3.5 shrink-0 rounded-[4px]";
  const cor: Record<Tom, string> = {
    livre: "border-2 border-dashed border-livre",
    aguardando: "bg-aguardando",
    atrasada: "bg-atrasada",
    ocupada: "bg-ocupada",
    limpar: "bg-limpar hachurado",
  };
  return <span aria-hidden className={`${base} ${cor[tom]}`} />;
}
