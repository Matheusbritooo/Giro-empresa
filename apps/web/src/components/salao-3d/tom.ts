/**
 * Com os efeitos ligados, o tom ACES é aplicado na imagem pronta (efeito ToneMapping) e não
 * por material: aí `toneMapped={false}` não segura mais a cor. Para o tapete e o contorno da
 * mesa continuarem com a cor exata dos tokens do painel, a cor entra "pré-corrigida": a conta
 * inversa do ACES, de modo que depois do efeito ela volte a ser o token.
 *
 * As contas são as mesmas do `ACESFilmicToneMapping` do three (tonemapping_pars_fragment),
 * que o postprocessing reaproveita. Tudo em RGB linear.
 */

export type Rgb = [number, number, number];

/** Exposição do tom (gl.toneMappingExposure), a mesma com e sem efeitos. */
export const EXPOSICAO = 1.05;

type Matriz = [Rgb, Rgb, Rgb];

// Linhas das matrizes (o shader as escreve transpostas).
const ENTRADA: Matriz = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const SAIDA: Matriz = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

function vezes(m: Matriz, v: Rgb): Rgb {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function inversa(m: Matriz): Matriz {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const ENTRADA_INV = inversa(ENTRADA);
const SAIDA_INV = inversa(SAIDA);

const limitar = (v: number) => Math.min(1, Math.max(0, v));

function curva(v: number): number {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}

/** Inversa da curva acima (resolve a equação do 2º grau). Só existe para y < 1/0,983729. */
function curvaInversa(y: number): number {
  const alvo = Math.min(Math.max(y, 0), 1.01);
  const a = 1 - 0.983729 * alvo;
  const b = 0.0245786 - 0.432951 * alvo;
  const c = -(0.000090537 + 0.238081 * alvo);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** O que o tom ACES do three faz com uma cor linear. */
export function aces(cor: Rgb, exposicao = 1): Rgb {
  const e = exposicao / 0.6;
  const entrada = vezes(ENTRADA, [cor[0] * e, cor[1] * e, cor[2] * e]);
  const saida = vezes(SAIDA, [curva(entrada[0]), curva(entrada[1]), curva(entrada[2])]);
  return [limitar(saida[0]), limitar(saida[1]), limitar(saida[2])];
}

/** A cor linear que, depois do tom ACES, vira `alvo` (também linear). */
export function antesDoAces(alvo: Rgb, exposicao = 1): Rgb {
  const meio = vezes(SAIDA_INV, alvo);
  const curvada: Rgb = [curvaInversa(meio[0]), curvaInversa(meio[1]), curvaInversa(meio[2])];
  const cor = vezes(ENTRADA_INV, curvada);
  const e = 0.6 / exposicao;
  return [Math.max(0, cor[0] * e), Math.max(0, cor[1] * e), Math.max(0, cor[2] * e)];
}
