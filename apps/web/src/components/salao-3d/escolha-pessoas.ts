/**
 * Quem aparece sentado em cada cadeira do 3D. Só contas, sem three.js, para dar para testar.
 *
 * As pessoas são ilustrativas: a câmera só conta quantas estão sentadas. A escolha do
 * cliente e da pose sai de (mesa, assento, hora em que a mesa foi ocupada), sem sorteio a
 * cada tela: a mesma visita mostra sempre as mesmas pessoas e uma visita nova muda tudo.
 */

import type { MesaNoSalao } from "./planta";

export interface ClienteParaEscolha {
  id: string;
  sexo: "F" | "M";
  poses: readonly string[];
}

/** Uma pessoa sentada: quem é, em que pose e como ajeitar na cadeira. */
export interface PessoaEscolhida {
  cliente: string;
  pose: string;
  /** Espelha a pose (x → -x) para o pé cruzado ir para o lado que tem espaço. */
  espelhar: boolean;
  /** Giro em y (radianos), antes do espelho, para o pé cruzado não entrar no pé da mesa. */
  giro: number;
  /** Fase da respiração, para ninguém respirar junto. */
  fase: number;
}

/**
 * Até onde vão os pés para o lado de cada um, a partir do centro do assento, medido nas
 * poses do `infra/modelos-3d`: as mulheres cruzam as pernas (0,39 m), os homens não (0,29 m).
 */
export const ALCANCE_DOS_PES = { F: 0.39, M: 0.29 } as const;
/** Fundura em que os pés ficam (z, a partir do centro do assento). */
const FUNDURA_DOS_PES = 0.45;
/** Pés da mesa quadrada ou comprida: 5,5 cm de lado, 8 cm para dentro da borda. */
const RECUO_PE_DA_MESA = 0.08;
const MEIO_PE_DA_MESA = 0.0275;
/** Faixa de fundura (z) onde um pé da mesa pode encostar nos pés de quem senta. */
const FAIXA_DOS_PES: [number, number] = [0.15, 0.7];
/** Quanto a pessoa pode girar na cadeira, no máximo, para os pés caberem. */
const GIRO_MAXIMO = 0.25;

/** FNV-1a de 32 bits: o mesmo texto dá sempre o mesmo número, em qualquer aparelho. */
export function resumo(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Gerador pseudoaleatório pequeno (mulberry32) a partir de uma semente. */
function gerador(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralhar<T>(lista: readonly T[], semente: number): T[] {
  const sorteio = gerador(semente);
  const saida = [...lista];
  for (let i = saida.length - 1; i > 0; i--) {
    const j = Math.floor(sorteio() * (i + 1));
    [saida[i], saida[j]] = [saida[j], saida[i]];
  }
  return saida;
}

/** Espaço livre de cada lado (x+ e x- de quem senta) até o pé da mesa mais perto. */
export function folgaDosLados(
  item: MesaNoSalao,
  indice: number,
): { xMais: number; xMenos: number } {
  const assento = item.assentos[indice];
  const livre = { xMais: Number.POSITIVE_INFINITY, xMenos: Number.POSITIVE_INFINITY };
  // Mesa redonda tem um pé só, no meio: longe dos pés de quem senta.
  if (!assento || item.forma.redonda) return livre;
  const meioX = item.forma.largura / 2 - RECUO_PE_DA_MESA;
  const meioZ = item.forma.profundidade / 2 - RECUO_PE_DA_MESA;
  const cos = Math.cos(assento.rotacao);
  const sen = Math.sin(assento.rotacao);
  for (const px of [-meioX, meioX]) {
    for (const pz of [-meioZ, meioZ]) {
      // Pé da mesa visto da cadeira: x para o lado, z para a frente (rotação inversa).
      const dx = px - assento.x;
      const dz = pz - assento.z;
      const lado = dx * cos - dz * sen;
      const frente = dx * sen + dz * cos;
      if (frente < FAIXA_DOS_PES[0] || frente > FAIXA_DOS_PES[1]) continue;
      const folga = Math.abs(lado) - MEIO_PE_DA_MESA;
      if (lado >= 0) livre.xMais = Math.min(livre.xMais, folga);
      else livre.xMenos = Math.min(livre.xMenos, folga);
    }
  }
  return livre;
}

/** Giro que traz o pé que vai mais longe (`alcance`, em x+) para dentro da `folga`. */
export function giroParaCaber(alcance: number, folga: number): number {
  if (alcance <= folga) return 0;
  // Girando -θ em y, o pé em (alcance, fundura) vai para x = alcance·cos θ − fundura·sen θ.
  let theta = 0;
  while (theta < GIRO_MAXIMO) {
    theta += 0.005;
    if (alcance * Math.cos(theta) - FUNDURA_DOS_PES * Math.sin(theta) <= folga) break;
  }
  return -Math.min(theta, GIRO_MAXIMO);
}

/**
 * Quem senta em cada um dos `sentados` primeiros assentos da mesa. A ordem dos clientes é
 * embaralhada por (mesa, sentou_em), sem repetir ninguém na mesma mesa enquanto der; a pose
 * e o lado saem de (mesa, assento, sentou_em).
 */
export function escolherPessoas(
  item: MesaNoSalao,
  sentados: number,
  sentouEm: string | null,
  clientes: readonly ClienteParaEscolha[],
): PessoaEscolhida[] {
  if (clientes.length === 0) return [];
  const visita = `${item.mesa.id}|${sentouEm ?? ""}`;
  const ordem = embaralhar(clientes, resumo(visita));
  const usados = new Set<string>();
  const saida: PessoaEscolhida[] = [];
  const quantos = Math.min(sentados, item.assentos.length);
  for (let i = 0; i < quantos; i++) {
    const h = resumo(`${item.mesa.id}|${i}|${sentouEm ?? ""}`);
    const cliente = ordem.find((c) => !usados.has(c.id)) ?? ordem[i % ordem.length];
    usados.add(cliente.id);
    const pose = cliente.poses[h % cliente.poses.length] ?? cliente.poses[0];

    // O pé cruzado fica em x+: espelha se o outro lado tem mais espaço; empate, sorteio fixo.
    const { xMais, xMenos } = folgaDosLados(item, i);
    const espelhar = Math.abs(xMais - xMenos) < 0.01 ? ((h >>> 4) & 1) === 1 : xMenos > xMais;
    const folga = espelhar ? xMenos : xMais;
    const giro = giroParaCaber(ALCANCE_DOS_PES[cliente.sexo], folga);
    const fase = (((h >>> 8) % 1000) / 1000) * Math.PI * 2;
    saida.push({ cliente: cliente.id, pose, espelhar, giro, fase });
  }
  return saida;
}
