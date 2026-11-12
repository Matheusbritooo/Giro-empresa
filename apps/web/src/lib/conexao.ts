"use client";

import { useSyncExternalStore } from "react";

// Se o painel está conseguindo falar com o servidor. Quem diz é a última chamada à API: o
// navegador só sabe se o Wi-Fi está ligado, não se a internet do salão caiu.
let ligada = true;
const ouvintes = new Set<() => void>();

export function marcarConexao(ok: boolean): void {
  if (ok === ligada) return;
  ligada = ok;
  for (const ouvinte of ouvintes) ouvinte();
}

export function conexaoLigada(): boolean {
  return ligada;
}

export function ouvirConexao(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** true enquanto a última chamada ao servidor respondeu; false quando a rede caiu. */
export function useConexao(): boolean {
  return useSyncExternalStore(ouvirConexao, conexaoLigada, () => true);
}
