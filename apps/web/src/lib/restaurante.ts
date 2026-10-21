"use client";

import { useSearchParams } from "next/navigation";

import { useSessao } from "./sessao";

/** De qual restaurante é a tela: o do usuário, ou o escolhido pela equipe GIRO na URL. */
export function useRestauranteAlvo(): number | null {
  const { sessao } = useSessao();
  const parametros = useSearchParams();
  if (!sessao) return null;
  if (sessao.usuario.papel === "admin_giro") {
    const id = Number(parametros.get("restaurante"));
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  return sessao.usuario.restaurante_id;
}
