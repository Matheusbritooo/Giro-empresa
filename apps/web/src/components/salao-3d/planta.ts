/**
 * Onde cada mesa e cada cadeira fica no salão em 3D. Só contas, sem three.js, para dar
 * para testar. Unidade: metro. O piso fica centrado na origem; x cresce para a direita,
 * z cresce para quem olha o salão de frente, y é a altura.
 */

import type { Mesa } from "@/lib/tipos";

/** Distância mínima entre os centros de duas mesas vizinhas na grade da planta. */
export const PASSO = 2.7;
/** Corredor entre as mesas da borda e as paredes (cabe o balcão e as plantas). */
export const MARGEM = 2.4;
/** Do centro do assento até a borda da mesa. */
const RECUO_CADEIRA = 0.34;
/** Meia largura da cadeira, para saber quanto espaço ela ocupa. */
const MEIA_CADEIRA = 0.24;
/** Espaço livre entre duas mesas, contando as cadeiras. */
const CORREDOR = 0.9;

export interface Forma {
  largura: number; // eixo x
  profundidade: number; // eixo z
  redonda: boolean;
}

/** Assento em volta da mesa, relativo ao centro dela. `rotacao` faz a cadeira olhar a mesa. */
export interface Assento {
  x: number;
  z: number;
  rotacao: number;
}

export interface MesaNoSalao {
  mesa: Mesa;
  x: number;
  z: number;
  forma: Forma;
  /** Em ordem de quem senta primeiro: os dois primeiros ficam frente a frente. */
  assentos: Assento[];
  /** Metade do espaço que mesa e cadeiras ocupam, em x e em z. */
  meiaPegada: { x: number; z: number };
}

export interface PlantaSalao {
  mesas: MesaNoSalao[];
  largura: number; // tamanho do piso em x, com a margem até as paredes
  profundidade: number; // tamanho do piso em z
  /**
   * x das faixas livres que correm de fundo a frente: uma entre cada par de colunas, uma
   * antes da primeira e uma depois da última. Em ordem crescente, todas dentro do piso.
   * Por elas o garçom anda sem esbarrar em mesa nem cadeira.
   */
  corredoresX: number[];
  /** O mesmo para as linhas: z das faixas livres que correm da esquerda para a direita. */
  corredoresZ: number[];
}

export function formaDaMesa(lugares: number): Forma {
  if (lugares <= 2) return { largura: 0.72, profundidade: 0.72, redonda: true };
  if (lugares <= 4) return { largura: 0.86, profundidade: 0.86, redonda: false };
  const porLado = Math.ceil((lugares - 2) / 2);
  return { largura: porLado * 0.64 + 0.24, profundidade: 0.9, redonda: false };
}

/** Rotação em y que faz algo de frente para +z olhar na direção (dx, dz). */
function olhando(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function assentosDaMesa(forma: Forma, lugares: number): Assento[] {
  const frente = forma.profundidade / 2 + RECUO_CADEIRA;
  const lado = forma.largura / 2 + RECUO_CADEIRA;
  const naFrente = (x: number): Assento => ({ x, z: frente, rotacao: olhando(0, -1) });
  const atras = (x: number): Assento => ({ x, z: -frente, rotacao: olhando(0, 1) });
  const esquerda: Assento = { x: -lado, z: 0, rotacao: olhando(1, 0) };
  const direita: Assento = { x: lado, z: 0, rotacao: olhando(-1, 0) };

  if (lugares <= 0) return [];
  if (lugares <= 2) return [naFrente(0), atras(0)].slice(0, lugares);
  if (lugares <= 4) return [naFrente(0), atras(0), esquerda, direita].slice(0, lugares);

  // Mesa comprida: cadeiras nos dois lados compridos e uma em cada ponta.
  const lados = lugares - 2;
  const quantosFrente = Math.ceil(lados / 2);
  const quantosAtras = lados - quantosFrente;
  const posicoes = (n: number) =>
    Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * (forma.largura / Math.max(n, 1)));
  const frenteXs = posicoes(quantosFrente);
  const atrasXs = posicoes(quantosAtras);
  const ordem: Assento[] = [];
  for (let i = 0; i < quantosFrente; i++) {
    ordem.push(naFrente(frenteXs[i]));
    if (i < quantosAtras) ordem.push(atras(atrasXs[i])); // um de frente para o outro
  }
  return [...ordem, esquerda, direita];
}

function meiaPegada(forma: Forma, assentos: Assento[]) {
  let x = forma.largura / 2;
  let z = forma.profundidade / 2;
  for (const a of assentos) {
    x = Math.max(x, Math.abs(a.x) + MEIA_CADEIRA);
    z = Math.max(z, Math.abs(a.z) + MEIA_CADEIRA);
  }
  return { x, z };
}

/**
 * Monta o salão a partir da grade da planta (pos_x, pos_y). Coluna ou linha com mesa
 * comprida ganha mais espaço, para nenhuma cadeira encostar na mesa vizinha.
 */
export function montarPlanta(mesas: Mesa[]): PlantaSalao {
  const preparadas = mesas.map((mesa) => {
    const forma = formaDaMesa(mesa.lugares);
    const assentos = assentosDaMesa(forma, mesa.lugares);
    return { mesa, forma, assentos, meiaPegada: meiaPegada(forma, assentos) };
  });
  if (preparadas.length === 0) {
    return {
      mesas: [],
      largura: PASSO + 2 * MARGEM,
      profundidade: PASSO + 2 * MARGEM,
      corredoresX: corredores([PASSO]),
      corredoresZ: corredores([PASSO]),
    };
  }

  const colunas = Math.max(...preparadas.map((p) => p.mesa.pos_x)) + 1;
  const linhas = Math.max(...preparadas.map((p) => p.mesa.pos_y)) + 1;
  const larguraColuna = Array.from({ length: colunas }, () => PASSO);
  const alturaLinha = Array.from({ length: linhas }, () => PASSO);
  for (const p of preparadas) {
    larguraColuna[p.mesa.pos_x] = Math.max(
      larguraColuna[p.mesa.pos_x],
      2 * p.meiaPegada.x + CORREDOR,
    );
    alturaLinha[p.mesa.pos_y] = Math.max(alturaLinha[p.mesa.pos_y], 2 * p.meiaPegada.z + CORREDOR);
  }

  const centros = (tamanhos: number[]) => {
    const total = tamanhos.reduce((a, b) => a + b, 0);
    let inicio = -total / 2;
    return tamanhos.map((t) => {
      const centro = inicio + t / 2;
      inicio += t;
      return centro;
    });
  };
  const xs = centros(larguraColuna);
  const zs = centros(alturaLinha);
  const larguraTotal = larguraColuna.reduce((a, b) => a + b, 0);
  const profundidadeTotal = alturaLinha.reduce((a, b) => a + b, 0);

  return {
    mesas: preparadas.map((p) => ({ ...p, x: xs[p.mesa.pos_x], z: zs[p.mesa.pos_y] })),
    largura: larguraTotal + 2 * MARGEM,
    profundidade: profundidadeTotal + 2 * MARGEM,
    corredoresX: corredores(larguraColuna),
    corredoresZ: corredores(alturaLinha),
  };
}

/**
 * Faixas livres de uma grade com estes tamanhos de coluna (ou linha), centrada na origem.
 * Entre duas colunas a faixa fica na divisa: cada mesa deixa pelo menos meio `CORREDOR`
 * até ela. Antes da primeira e depois da última, a faixa fica meio `CORREDOR` para fora
 * da grade, longe do balcão e das plantas que ficam junto às paredes.
 */
function corredores(tamanhos: number[]): number[] {
  const total = tamanhos.reduce((a, b) => a + b, 0);
  const faixas = [-total / 2 - CORREDOR / 2];
  let divisa = -total / 2;
  for (const t of tamanhos.slice(0, -1)) {
    divisa += t;
    faixas.push(divisa);
  }
  faixas.push(total / 2 + CORREDOR / 2);
  return faixas;
}

/** Ponto na mesa em frente a um assento: onde vão o prato e o copo. */
export function lugarNaMesa(assento: Assento, recuo = RECUO_CADEIRA + 0.2) {
  return {
    x: assento.x + Math.sin(assento.rotacao) * recuo,
    z: assento.z + Math.cos(assento.rotacao) * recuo,
  };
}
