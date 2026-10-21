"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Marca } from "@/components/marca";
import { paginaInicial, useSessao } from "@/lib/sessao";

export default function Inicio() {
  const { sessao, carregando } = useSessao();
  const router = useRouter();

  useEffect(() => {
    if (carregando) return;
    router.replace(sessao ? paginaInicial(sessao.usuario.papel) : "/entrar");
  }, [carregando, sessao, router]);

  return (
    <main className="grid flex-1 place-items-center">
      <Marca tamanho={48} />
    </main>
  );
}
