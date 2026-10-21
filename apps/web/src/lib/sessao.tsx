"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, ErroApi } from "./api";
import type { Papel, Sessao } from "./tipos";

interface ContextoSessao {
  sessao: Sessao | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<Sessao>;
  sair: () => Promise<void>;
}

const Contexto = createContext<ContextoSessao | null>(null);

export function ProvedorSessao({ children }: { children: React.ReactNode }) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api<Sessao>("/api/auth/sessao")
      .then(setSessao)
      .catch(() => setSessao(null))
      .finally(() => setCarregando(false));
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    const nova = await api<Sessao>("/api/auth/entrar", {
      metodo: "POST",
      corpo: { email, senha },
    });
    setSessao(nova);
    return nova;
  }, []);

  const sair = useCallback(async () => {
    await api("/api/auth/sair", { metodo: "POST" }).catch(() => undefined);
    setSessao(null);
  }, []);

  return (
    <Contexto.Provider value={{ sessao, carregando, entrar, sair }}>{children}</Contexto.Provider>
  );
}

export function useSessao(): ContextoSessao {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error("useSessao precisa estar dentro de ProvedorSessao");
  return contexto;
}

/** Sessão obrigatória: sem login, manda para a tela de entrar. */
export function useSessaoObrigatoria(): Sessao | null {
  const { sessao, carregando } = useSessao();
  const router = useRouter();
  useEffect(() => {
    if (!carregando && !sessao) router.replace("/entrar");
  }, [carregando, sessao, router]);
  return sessao;
}

export function paginaInicial(papel: Papel): string {
  return papel === "admin_giro" ? "/restaurantes" : "/salao";
}

export const podeGerirMesas = (papel: Papel) => papel !== "equipe";
export const podeGerirEquipe = (papel: Papel) => papel === "dono" || papel === "admin_giro";

export { ErroApi };
