import type { Metadata } from "next";
import { Suspense } from "react";

import { Marca } from "@/components/marca";

import { MesaDoCliente } from "./mesa-do-cliente";

export const metadata: Metadata = {
  title: "Sua mesa",
  // A página de cada mesa não aparece em busca nenhuma.
  robots: { index: false, follow: false },
};

/** A página do QR da mesa: o cliente do restaurante, sem login. */
export default function PaginaDaMesa() {
  return (
    <Suspense
      fallback={
        <main className="grid flex-1 place-items-center">
          <Marca tamanho={40} />
        </main>
      }
    >
      <MesaDoCliente />
    </Suspense>
  );
}
