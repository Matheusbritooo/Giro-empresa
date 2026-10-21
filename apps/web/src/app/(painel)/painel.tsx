"use client";

import { Cabecalho } from "@/components/cabecalho";
import { Marca } from "@/components/marca";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { useSessaoObrigatoria } from "@/lib/sessao";

export function Painel({ children }: { children: React.ReactNode }) {
  const sessao = useSessaoObrigatoria();
  const restaurante = useRestauranteAlvo();

  if (!sessao) {
    return (
      <main className="grid flex-1 place-items-center">
        <Marca tamanho={40} />
      </main>
    );
  }

  return (
    <>
      <Cabecalho
        sessao={sessao}
        restaurante={restaurante}
        nomeRestaurante={sessao.restaurante?.nome ?? null}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        {children}
      </main>
    </>
  );
}
