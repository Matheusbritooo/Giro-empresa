/**
 * Os modelos 3D de gente (clientes sentados e garçom) que ficam em `public/modelos`, gerados
 * por `infra/modelos-3d`. O manifesto entra no pacote (é pequeno); os .glb são baixados
 * do próprio painel quando o 3D abre, nunca de CDN.
 */

import manifestoJson from "../../../public/modelos/manifesto.json";

export interface ClienteDoManifesto {
  id: string;
  arquivo: string;
  sexo: "F" | "M";
  /** Nomes das malhas no .glb: cada uma é a pessoa já sentada numa pose. */
  poses: readonly string[];
  papeis: Record<string, string>;
  altura: number;
}

export interface GarcomDoManifesto {
  arquivo: string;
  /** Duração de cada clipe, em segundos. */
  clipes: Record<"parado" | "andando" | "anotando", number>;
  /** Metros por segundo em que o pé de apoio fica parado no chão durante o "andando". */
  velocidade: number;
  altura: number;
}

export interface Manifesto {
  versao: number;
  clientes: ClienteDoManifesto[];
  garcom: GarcomDoManifesto;
}

export const MANIFESTO = manifestoJson as unknown as Manifesto;

/** Endereço de um arquivo do manifesto, servido pelo próprio painel. */
export function urlDoModelo(arquivo: string): string {
  return `/modelos/${arquivo}`;
}

export const URLS_CLIENTES = MANIFESTO.clientes.map((c) => urlDoModelo(c.arquivo));
export const URL_GARCOM = urlDoModelo(MANIFESTO.garcom.arquivo);
