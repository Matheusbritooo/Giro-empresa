import { Suspense } from "react";

import { Marca } from "@/components/marca";

import { Painel } from "./painel";

export default function LayoutPainel({ children }: LayoutProps<"/">) {
  return (
    <Suspense
      fallback={
        <main className="grid flex-1 place-items-center">
          <Marca tamanho={40} />
        </main>
      }
    >
      <Painel>{children}</Painel>
    </Suspense>
  );
}
