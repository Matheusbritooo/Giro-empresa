/**
 * Para onde a câmera do 3D vai quando o Marcos escolhe uma mesa: de frente e um pouco pela
 * direita, como a vista inicial, mais perto e mirando o centro da mesa. Só contas.
 */

import type { MesaNoSalao, PlantaSalao } from "./planta";

/** Altura do tampo, a mesma de `ALTURA_TAMPO` em geometrias.ts (o teste confere). */
export const ALTURA_ALVO_MESA = 0.75;

export interface OpcoesEnquadrar {
  /** Distância da câmera até o centro da mesa, em metros. */
  distancia?: number;
  /** Ângulo acima do chão, em radianos (0 = rente ao chão, π/2 = de cima). */
  elevacao?: number;
  /** Quanto gira para a direita a partir da frente (+z), em radianos. */
  giro?: number;
}

export interface Enquadramento {
  posicao: [number, number, number];
  alvo: [number, number, number];
}

const PADRAO = { distancia: 5, elevacao: 0.62, giro: 0.6 };

/**
 * Vista de 3/4 da mesa, a uns 5 m. O giro e a elevação ficam sempre do lado da frente e da
 * direita (x e z crescendo), onde o salão não tem parede; assim a câmera nunca fica atrás da
 * parede do fundo nem da esquerda.
 */
export function enquadrarMesa(
  item: MesaNoSalao,
  planta: PlantaSalao,
  opcoes: OpcoesEnquadrar = {},
): Enquadramento {
  const distancia = Math.max(0.5, opcoes.distancia ?? PADRAO.distancia);
  const elevacao = Math.min(Math.PI / 2 - 0.05, Math.max(0.15, opcoes.elevacao ?? PADRAO.elevacao));
  const giro = Math.min(Math.PI / 2 - 0.05, Math.max(0, opcoes.giro ?? PADRAO.giro));
  const alvo: [number, number, number] = [item.x, ALTURA_ALVO_MESA, item.z];
  const horizontal = Math.cos(elevacao) * distancia;
  let x = alvo[0] + Math.sin(giro) * horizontal;
  let z = alvo[2] + Math.cos(giro) * horizontal;
  // Pelas contas acima a câmera já fica à frente e à direita da mesa; isto só garante que ela
  // continua dentro das paredes do fundo e da esquerda mesmo com opções estranhas.
  x = Math.max(x, -planta.largura / 2 + 0.3);
  z = Math.max(z, -planta.profundidade / 2 + 0.3);
  return { posicao: [x, alvo[1] + Math.sin(elevacao) * distancia, z], alvo };
}
