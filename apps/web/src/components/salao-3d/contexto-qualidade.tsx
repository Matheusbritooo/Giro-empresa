"use client";

import { useThree } from "@react-three/fiber";
import { createContext, type ReactNode, useCallback, useContext, useEffect } from "react";

import { type Ajustes, ajustesDoNivel, type Nivel } from "./qualidade";

export interface Qualidade extends Ajustes {
  nivel: Nivel;
}

const Contexto = createContext<Qualidade>({ nivel: "baixo", ...ajustesDoNivel("baixo") });

/** Deixa o nível de acabamento à mão de qualquer peça do salão 3D. */
export function QualidadeProvider({ nivel, children }: { nivel: Nivel; children: ReactNode }) {
  const valor = qualidadeDe(nivel);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

const POR_NIVEL = new Map<Nivel, Qualidade>();

/** Sempre o mesmo objeto para o mesmo nível: quem lê o contexto só redesenha se o nível mudar. */
function qualidadeDe(nivel: Nivel): Qualidade {
  let valor = POR_NIVEL.get(nivel);
  if (!valor) {
    valor = { nivel, ...ajustesDoNivel(nivel) };
    POR_NIVEL.set(nivel, valor);
  }
  return valor;
}

export function useQualidade(): Qualidade {
  return useContext(Contexto);
}

/**
 * As sombras não se refazem sozinhas a cada quadro (`shadowMap.autoUpdate = false`): quem
 * muda o salão chama este gancho. Ele refaz a sombra quando `chave` muda e devolve a função
 * para refazer na hora. Também pede um quadro novo, para o Canvas sob demanda.
 */
export function useRefazerSombra(chave?: unknown): () => void {
  // Lê o renderizador na hora (get), em vez de guardar e mexer num valor do gancho.
  const get = useThree((s) => s.get);
  const refazer = useCallback(() => {
    const { gl, invalidate } = get();
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [get]);
  useEffect(() => {
    refazer();
  }, [refazer, chave]);
  return refazer;
}
