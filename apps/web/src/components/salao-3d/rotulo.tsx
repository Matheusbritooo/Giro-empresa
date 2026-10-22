import type { Ref } from "react";

import type { Situacao, Tom } from "@/lib/salao";
import type { Mesa } from "@/lib/tipos";

// Mesma linguagem da planta: cor + padrão + palavra. Livre ganha fundo para ler sobre o piso.
const ESTILO: Record<Tom, string> = {
  livre: "border-2 border-dashed border-livre bg-superficie/90 text-tinta",
  aguardando: "bg-aguardando text-sobre-aguardando",
  atrasada: "bg-atrasada text-sobre-cor chamando",
  ocupada: "bg-ocupada text-sobre-cor",
  limpar: "bg-limpar text-sobre-cor hachurado",
};

/**
 * Placa sobre a mesa: número, cronômetro e estado. É um botão comum da página (dá para
 * usar com teclado e leitor de tela); quem a leva até cima da mesa é o `Projetor` da cena.
 * Com o 3D estreito (celular), a placa encolhe e o cronômetro fica no detalhe da mesa.
 */
export function RotuloMesa({
  mesa,
  situacao,
  cronometro,
  aoAbrir,
  ref,
}: {
  mesa: Mesa;
  situacao: Situacao;
  cronometro: string | null;
  aoAbrir: (mesaId: number) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => aoAbrir(mesa.id)}
      aria-label={`${situacao.descricao}${cronometro ? `, há ${cronometro}` : ""}`}
      data-estado={situacao.tom}
      data-testid={`mesa-${mesa.numero}`}
      data-vista="3d"
      style={{ visibility: "hidden" }}
      className={`pointer-events-auto absolute top-0 left-0 flex select-none items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1 text-left @max-lg:gap-1 @max-lg:rounded-md @max-lg:px-1.5 @max-lg:py-0.5 shadow-lg shadow-black/25 ${ESTILO[situacao.tom]}`}
    >
      <span className="font-placa text-[1.7rem] font-extrabold leading-none @max-lg:text-[1.1rem]">
        {mesa.numero}
      </span>
      <span className="flex flex-col leading-tight">
        {cronometro && (
          <span className="numeros text-sm font-bold @max-lg:hidden">{cronometro}</span>
        )}
        <span className="text-[0.7rem] font-semibold @max-lg:text-[0.58rem]">{situacao.curto}</span>
      </span>
    </button>
  );
}
