/**
 * Texturas PBR do salão (cor, relevo e aspereza) geradas no código, sem baixar imagem.
 *
 * Só contas sobre Uint8Array: roda no navegador e no Vitest, sem canvas e sem WebGL. O lado
 * do three (texturas-three.ts) embrulha os bytes em DataTexture e gera aos poucos, uma
 * fatia de linhas por vez, para não travar a tela. Os desenhos repetem sem emenda (ruído
 * periódico), então uma textura cobre o piso inteiro com repetição.
 *
 * Convenções do three: normal em espaço tangente com Y para cima e a linha 0 da imagem em
 * v = 0 (a DataTexture não vira a imagem); "orm" tem a oclusão no R, a aspereza no G e o
 * metal no B, então o mesmo mapa serve de aoMap e de roughnessMap.
 *
 * Madeira, reboco e lambri saem quase brancos: a cor de verdade vem de `material.color`,
 * então o mesmo desenho serve para o tampo, as cadeiras e o balcão.
 */

export interface MapasPBR {
  tamanho: number;
  /** RGBA em sRGB. */
  cor: Uint8Array;
  /** RGBA linear: normal em espaço tangente. */
  normal: Uint8Array;
  /** RGBA linear: R = oclusão, G = aspereza, B = metal. */
  orm: Uint8Array;
}

/** Gera a textura uma fatia de linhas por vez: cada `yield` é uma pausa possível. */
export type GeracaoFatiada = Generator<void, MapasPBR, void>;

export type NomeTextura = "piso" | "reboco" | "lambri" | "madeira" | "toalha";

const LINHAS_POR_FATIA = 8;

// ---------------------------------------------------------------- ruído periódico

/** Hash inteiro repetível: sem Math.random, a textura sai igual toda vez. */
function hash(x: number, y: number, semente: number): number {
  let h = (x * 374761393 + y * 668265263 + semente * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Ruído de valor que repete a cada `periodo` células (a textura não tem emenda). */
function ruido(x: number, y: number, periodo: number, semente: number, periodoY = periodo): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const x0 = ((xi % periodo) + periodo) % periodo;
  const y0 = ((yi % periodoY) + periodoY) % periodoY;
  const x1 = (x0 + 1) % periodo;
  const y1 = (y0 + 1) % periodoY;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, semente);
  const b = hash(x1, y0, semente);
  const c = hash(x0, y1, semente);
  const d = hash(x1, y1, semente);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Soma de oitavas (fBm). `u` e `v` vão de 0 a 1; `escala` é o número de células da primeira
 * oitava. `esticar` > 1 deixa o desenho comprido no sentido de u (veio de madeira).
 */
function fbm(
  u: number,
  v: number,
  escala: number,
  oitavas: number,
  semente: number,
  esticar = 1,
): number {
  let soma = 0;
  let amplitude = 0.5;
  let frequencia = escala;
  let norma = 0;
  for (let o = 0; o < oitavas; o++) {
    const fy = frequencia * esticar;
    soma += amplitude * ruido(u * frequencia, v * fy, frequencia, semente + o * 101, fy);
    norma += amplitude;
    amplitude *= 0.5;
    frequencia *= 2;
  }
  return soma / norma;
}

function limitar(v: number, min = 0, max = 1) {
  return v < min ? min : v > max ? max : v;
}

/** Cor em sRGB de 0 a 1 para bytes. */
function pintar(buf: Uint8Array, i: number, r: number, g: number, b: number) {
  buf[i] = Math.round(limitar(r) * 255);
  buf[i + 1] = Math.round(limitar(g) * 255);
  buf[i + 2] = Math.round(limitar(b) * 255);
  buf[i + 3] = 255;
}

function pintarOrm(buf: Uint8Array, i: number, oclusao: number, aspereza: number) {
  pintar(buf, i, oclusao, aspereza, 0);
}

/** Degrau suave de 0 a 1 entre `a` e `b`. */
function degrau(a: number, b: number, x: number) {
  const t = limitar((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- esqueleto comum

type PintarLinha = (
  y: number,
  n: number,
  cor: Uint8Array,
  orm: Uint8Array,
  relevo: Float32Array,
) => void;

/** Pinta linha a linha e depois tira a normal do relevo (Sobel, dando a volta na borda). */
function* gerar(n: number, pintarLinha: PintarLinha, forcaNormal: number): GeracaoFatiada {
  const cor = new Uint8Array(n * n * 4);
  const orm = new Uint8Array(n * n * 4);
  const relevo = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    pintarLinha(y, n, cor, orm, relevo);
    if ((y + 1) % LINHAS_POR_FATIA === 0) yield;
  }

  const normal = new Uint8Array(n * n * 4);
  // A força é por textura inteira: a 256 px o mesmo relevo tem metade dos pixels de subida.
  const forca = (forcaNormal * n) / 512;
  const h = (x: number, y: number) => relevo[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx =
        h(x + 1, y - 1) +
        2 * h(x + 1, y) +
        h(x + 1, y + 1) -
        (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy =
        h(x - 1, y + 1) +
        2 * h(x, y + 1) +
        h(x + 1, y + 1) -
        (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
      const nx = (-dx * forca) / 8;
      const ny = (-dy * forca) / 8;
      const comprimento = Math.hypot(nx, ny, 1);
      const i = (y * n + x) * 4;
      normal[i] = Math.round(((nx / comprimento) * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round(((ny / comprimento) * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round(((1 / comprimento) * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
    if ((y + 1) % (LINHAS_POR_FATIA * 2) === 0) yield;
  }
  return { tamanho: n, cor, normal, orm };
}

/** Roda a geração inteira de uma vez (testes e quem não liga de esperar). */
export function concluir(geracao: GeracaoFatiada): MapasPBR {
  let passo = geracao.next();
  while (!passo.done) passo = geracao.next();
  return passo.value;
}

// ---------------------------------------------------------------- piso de tábua envernizada

/**
 * Piso de tábuas corridas: 12 fileiras por repetição (a repetição cobre 2,4 m, então cada
 * tábua tem 20 cm de largura e 1,2 m de comprimento), emendas desencontradas, cada tábua com
 * um tom, veio comprido e verniz com desgaste (aspereza variando).
 */
export function pisoEmFatias(tamanho = 512, semente = 7): GeracaoFatiada {
  const fileiras = 12;
  const emendas = Array.from({ length: fileiras }, (_, f) => hash(f, 3, semente));
  const juntaPx = 1.4 * Math.max(1, tamanho / 512);
  return gerar(
    tamanho,
    (y, n, cor, orm, relevo) => {
      const alturaFileira = n / fileiras;
      const f = Math.floor(y / alturaFileira);
      const dentroY = (y - f * alturaFileira) / alturaFileira;
      const v = y / n;
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const deslocado = (u + emendas[f]) % 1;
        const tabua = deslocado < 0.5 ? 0 : 1;
        const dentroX = (deslocado % 0.5) / 0.5;
        const id = f * 2 + tabua;

        const veio = fbm(u, v, 2, 4, semente + id, 10);
        const aneis =
          0.5 + 0.5 * Math.sin((dentroY * 2.2 + veio * 3.2 + hash(id, 9, semente)) * Math.PI * 4);
        const tom = hash(id, 1, semente);
        const fibra = ruido(u * 24, v * 384, 24, semente + 5, 384);

        const bordaY = Math.min(dentroY, 1 - dentroY) * alturaFileira;
        const bordaX = Math.min(dentroX, 1 - dentroX) * (n / 2);
        const vale = degrau(juntaPx * 0.5, juntaPx * 2, Math.min(bordaY, bordaX));

        const i = y * n + x;
        relevo[i] = vale + (aneis * 0.05 + fibra * 0.04) * vale;

        const base = 0.4 + tom * 0.13;
        const escuro = 0.8 + 0.2 * aneis;
        const r = base * escuro * (0.93 + fibra * 0.1);
        const sujeira = 0.5 + 0.5 * vale;
        pintar(cor, i * 4, r * sujeira, r * 0.63 * sujeira, r * 0.4 * sujeira);

        const desgaste = fbm(u, v, 3, 3, semente + 77);
        const aspereza = 0.24 + desgaste * 0.24 + fibra * 0.06 + (1 - vale) * 0.5;
        pintarOrm(orm, i * 4, 0.55 + 0.45 * vale, aspereza);
      }
    },
    3,
  );
}

// ---------------------------------------------------------------- reboco (parede)

/** Reboco pintado: ondulação da desempenadeira, grão de areia e manchas leves de pintura. */
export function rebocoEmFatias(tamanho = 512, semente = 11): GeracaoFatiada {
  return gerar(
    tamanho,
    (y, n, cor, orm, relevo) => {
      const v = y / n;
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const grosso = fbm(u, v, 4, 3, semente);
        const areia = fbm(u, v, 64, 2, semente + 50);
        const manchas = fbm(u, v, 2, 3, semente + 90);
        const i = y * n + x;
        relevo[i] = grosso * 0.5 + areia * 0.5;
        const tom = 0.9 + manchas * 0.1 + (areia - 0.5) * 0.06;
        pintar(cor, i * 4, tom, tom, tom);
        pintarOrm(orm, i * 4, 0.86 + areia * 0.14, 0.8 + areia * 0.16);
      }
    },
    1.2,
  );
}

// ---------------------------------------------------------------- lambri (painel de tábuas)

/**
 * Lambri de tábuas em pé, macho e fêmea, pintado: 8 tábuas por repetição com o friso fundo
 * entre elas e um pouco do veio aparecendo debaixo da tinta.
 */
export function lambriEmFatias(tamanho = 512, semente = 19): GeracaoFatiada {
  const tabuas = 8;
  const frisoPx = 2 * Math.max(1, tamanho / 512);
  return gerar(
    tamanho,
    (y, n, cor, orm, relevo) => {
      const v = y / n;
      const larguraTabua = n / tabuas;
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const dentro = (x % larguraTabua) / larguraTabua;
        const borda = Math.min(dentro, 1 - dentro) * larguraTabua;
        const vale = degrau(frisoPx * 0.5, frisoPx * 2.5, borda);
        // Veio em pé (comprido no sentido de v): troca u e v.
        const veio = fbm(v, u, 3, 3, semente + Math.floor(x / larguraTabua), 6);
        const pincel = ruido(u * 96, v * 8, 96, semente + 3, 8);
        const i = y * n + x;
        relevo[i] = vale * 0.9 + veio * 0.05 * vale + pincel * 0.03;
        const tom = (0.86 + veio * 0.1 + pincel * 0.04) * (0.62 + 0.38 * vale);
        pintar(cor, i * 4, tom, tom, tom);
        pintarOrm(orm, i * 4, 0.5 + 0.5 * vale, 0.48 + pincel * 0.12 + (1 - vale) * 0.3);
      }
    },
    2.4,
  );
}

// ---------------------------------------------------------------- madeira (tampo e cadeiras)

/** Madeira maciça envernizada: veio comprido em u, anéis e poros. Clara, tingida pela cor do material. */
export function madeiraEmFatias(tamanho = 512, semente = 23): GeracaoFatiada {
  return gerar(
    tamanho,
    (y, n, cor, orm, relevo) => {
      const v = y / n;
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const veio = fbm(u, v, 2, 4, semente, 6);
        const aneis = 0.5 + 0.5 * Math.sin((v * 7 + veio * 4) * Math.PI * 2);
        const poros = ruido(u * 32, v * 512, 32, semente + 9, 512);
        const i = y * n + x;
        relevo[i] = aneis * 0.25 + poros * 0.15;
        const tom = 0.76 + aneis * 0.16 + poros * 0.08;
        pintar(cor, i * 4, tom, tom * 0.97, tom * 0.93);
        pintarOrm(orm, i * 4, 0.92 + poros * 0.08, 0.34 + (1 - aneis) * 0.12 + poros * 0.1);
      }
    },
    0.9,
  );
}

// ---------------------------------------------------------------- toalha xadrez de cantina

/**
 * Toalha xadrez vermelha e branca (gingham): faixas vermelhas na trama e na urdidura, o
 * cruzamento mais escuro e a tecelagem tafetá (fio por cima e por baixo) no relevo.
 * 8 quadrados por repetição.
 */
export function toalhaEmFatias(tamanho = 512, semente = 3): GeracaoFatiada {
  const quadros = 8;
  const fios = tamanho >= 512 ? 12 : 6;
  const vermelho: [number, number, number] = [0.66, 0.09, 0.09];
  const branco: [number, number, number] = [0.95, 0.93, 0.89];
  return gerar(
    tamanho,
    (y, n, cor, orm, relevo) => {
      const v = y / n;
      const periodoFio = n / (quadros * fios);
      const fy = Math.floor(v * quadros) % 2;
      const py = y / periodoFio;
      const cy = Math.floor(py);
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const fx = Math.floor(u * quadros) % 2;
        // 0 = branco, 0,5 = uma faixa (rosado), 1 = cruzamento (vermelho cheio).
        const tinta = (fx + fy) / 2;
        const px = x / periodoFio;
        const cx = Math.floor(px);
        const porCima = (cx + cy) % 2 === 0;
        const fio = porCima ? Math.sin((py - cy) * Math.PI) : Math.sin((px - cx) * Math.PI);
        const fiapo = ruido(u * 128, v * 128, 128, semente) * 0.25;
        const i = y * n + x;
        relevo[i] = fio * 0.6 + fiapo;
        const sombra = 0.86 + 0.14 * fio;
        pintar(
          cor,
          i * 4,
          (branco[0] + (vermelho[0] - branco[0]) * tinta) * sombra,
          (branco[1] + (vermelho[1] - branco[1]) * tinta) * sombra,
          (branco[2] + (vermelho[2] - branco[2]) * tinta) * sombra,
        );
        pintarOrm(orm, i * 4, 0.75 + 0.25 * fio, 0.82 + fiapo * 0.4);
      }
    },
    0.8,
  );
}

const RECEITAS: Record<NomeTextura, (tamanho: number) => GeracaoFatiada> = {
  piso: pisoEmFatias,
  reboco: rebocoEmFatias,
  lambri: lambriEmFatias,
  madeira: madeiraEmFatias,
  toalha: toalhaEmFatias,
};

export const NOMES_TEXTURAS = Object.keys(RECEITAS) as NomeTextura[];

/** Começa a gerar uma textura (fatiada). */
export function gerarTextura(nome: NomeTextura, tamanho: number): GeracaoFatiada {
  return RECEITAS[nome](tamanho);
}
