/**
 * Formas do salão montadas com peças simples (caixa, cilindro, perfil girado, tubo) e
 * juntadas numa geometria só por material. Uma cadeira vira um desenho só para a placa de
 * vídeo, não dez. Tudo olha para +z: a cadeira tem o encosto em -z e a pessoa olha para +z.
 * As coordenadas de textura ficam em metros (veja `REPETICAO`).
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { Forma } from "./planta";

const guardadas = new Map<string, unknown>();

function lembrar<T>(chave: string, criar: () => T): T {
  if (!guardadas.has(chave)) guardadas.set(chave, criar());
  return guardadas.get(chave) as T;
}

function juntar(partes: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Para juntar, ou todas as peças têm índice ou nenhuma tem.
  const mistas = partes.some((p) => p.index) && partes.some((p) => !p.index);
  const iguais = mistas ? partes.map((p) => (p.index ? p.toNonIndexed() : p)) : partes;
  const junta = mergeGeometries(iguais);
  for (const parte of new Set([...partes, ...iguais])) parte.dispose();
  if (!junta) throw new Error("peças com atributos diferentes");
  return junta;
}

const caixa = (l: number, a: number, p: number, x: number, y: number, z: number) =>
  new THREE.BoxGeometry(l, a, p).translate(x, y, z);

const cilindro = (r: number, a: number, x: number, y: number, z: number, lados = 18) =>
  new THREE.CylinderGeometry(r, r, a, lados).translate(x, y, z);

/** Cápsula de pé (eixo y), deitada para frente (eixo z) ou inclinada `angulo` em x. */
function capsula(r: number, comprimento: number, angulo = 0) {
  return new THREE.CapsuleGeometry(r, comprimento, 6, 14).rotateX(angulo);
}

const esfera = (r: number, x: number, y: number, z: number) =>
  new THREE.SphereGeometry(r, 20, 14).translate(x, y, z);

export const ALTURA_TAMPO = 0.75;
/** Topo da toalha, logo acima do tampo: é onde pratos e copos ficam. */
export const ALTURA_TOALHA = ALTURA_TAMPO + 0.004;
/** Barra da toalha: as coxas de quem está sentado passam por baixo dela. */
export const BARRA_TOALHA = 0.63;
/** Topo do assento da cadeira (onde a pessoa senta). */
export const ALTURA_ASSENTO = 0.477;

/** Metros cobertos por uma repetição de cada textura. */
export const REPETICAO = { madeira: 1, reboco: 2, lambri: 1.2, toalha: 0.32 } as const;

type Eixo = "x" | "y" | "z";

/**
 * Coordenada de textura em metros, projetada pela face (como uma caixa): cada face pega os
 * dois eixos que não são a sua normal. `veio` diz em que eixo corre o desenho comprido da
 * textura (o veio da madeira, o friso do lambri).
 */
export function uvEmMetros(
  g: THREE.BufferGeometry,
  metros: number,
  veio: Eixo = "x",
): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const normal = g.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(normal, i);
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const face: Eixo = ax >= ay && ax >= az ? "x" : ay >= az ? "y" : "z";
    const livres = (["x", "y", "z"] as const).filter((e) => e !== face);
    const u = livres.includes(veio) ? veio : livres[0];
    const w = livres.find((e) => e !== u) as Eixo;
    uv[i * 2] = v[u] / metros;
    uv[i * 2 + 1] = v[w] / metros;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Estica a coordenada de textura que a forma já tem (tubo, torno) para metros. */
function escalarUV(g: THREE.BufferGeometry, su: number, sv: number, trocar = false) {
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) * su;
    const v = uv.getY(i) * sv;
    if (trocar) uv.setXY(i, v, u);
    else uv.setXY(i, u, v);
  }
  return g;
}

/** Perna torneada de cadeira (perfil girado), com os anéis de enfeite. */
function pernaTorneada(altura: number): THREE.BufferGeometry {
  const perfil = [
    [0, 0],
    [0.012, 0],
    [0.0135, 0.008],
    [0.0115, 0.05],
    [0.0145, 0.11],
    [0.017, 0.145],
    [0.0125, 0.165],
    [0.0125, 0.21],
    [0.016, 0.29],
    [0.0185, 0.34],
    [0.014, 0.37],
    [0.019, 0.39],
    [0.019, altura],
    [0, altura],
  ].map(([r, y]) => new THREE.Vector2(r, Math.min(y, altura)));
  const g = new THREE.LatheGeometry(perfil, 10);
  // Torno: u dá a volta e v sobe. O veio corre ao longo da perna.
  return escalarUV(g, (2 * Math.PI * 0.016) / REPETICAO.madeira, altura / REPETICAO.madeira, true);
}

function tubo(pontos: [number, number, number][], raio: number, partes: number) {
  const curva = new THREE.CatmullRomCurve3(pontos.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curva, partes, raio, 8, false);
  return escalarUV(
    g,
    curva.getLength() / REPETICAO.madeira,
    (2 * Math.PI * raio) / REPETICAO.madeira,
  );
}

/**
 * Cadeira de bistrô, de madeira curvada: assento redondo com o topo em ALTURA_ASSENTO, quatro
 * pernas torneadas um pouco abertas, aro entre as pernas e o encosto em arco (uma peça só
 * que sai do assento, sobe e faz a curva) com uma travessa curva no meio. Encosto em -z: a
 * pessoa olha para +z. Tudo junto numa geometria só.
 */
export function geometriaCadeira(): THREE.BufferGeometry {
  return lembrar("cadeira", () => {
    const espessura = 0.035;
    const baseAssento = ALTURA_ASSENTO - espessura;
    const partes: THREE.BufferGeometry[] = [
      uvEmMetros(
        new THREE.CylinderGeometry(0.215, 0.205, espessura, 36).translate(
          0,
          ALTURA_ASSENTO - espessura / 2,
          0.005,
        ),
        REPETICAO.madeira,
      ),
      // Aro debaixo do assento e aro entre as pernas.
      escalarUV(
        new THREE.TorusGeometry(0.19, 0.011, 6, 36)
          .rotateX(Math.PI / 2)
          .translate(0, baseAssento - 0.008, 0.005),
        (2 * Math.PI * 0.19) / REPETICAO.madeira,
        0.07,
      ),
      escalarUV(
        new THREE.TorusGeometry(0.2, 0.008, 6, 36).rotateX(Math.PI / 2).translate(0, 0.2, 0.005),
        (2 * Math.PI * 0.2) / REPETICAO.madeira,
        0.05,
      ),
    ];
    for (const x of [-0.14, 0.14]) {
      for (const z of [-0.13, 0.14]) {
        // Pernas um pouco abertas para fora, como na cadeira de verdade.
        const perna = pernaTorneada(baseAssento)
          .translate(0, -baseAssento, 0)
          .rotateZ(Math.sign(x) * 0.05)
          .rotateX(-Math.sign(z) * 0.05)
          .translate(x, baseAssento, z);
        partes.push(perna);
      }
    }
    // Encosto em arco: sai do assento atrás, sobe inclinado para trás e fecha em cima.
    partes.push(
      tubo(
        [
          [-0.15, baseAssento + 0.01, -0.13],
          [-0.16, 0.64, -0.185],
          [-0.155, 0.84, -0.215],
          [-0.11, 0.925, -0.235],
          [0, 0.95, -0.245],
          [0.11, 0.925, -0.235],
          [0.155, 0.84, -0.215],
          [0.16, 0.64, -0.185],
          [0.15, baseAssento + 0.01, -0.13],
        ],
        0.014,
        72,
      ),
    );
    // Travessa curva do encosto: um pedaço de anel com espessura, abraçando as costas.
    const raio = 0.43; // arco que passa pelos dois montantes e recua 3 cm no meio
    const meiaAbertura = Math.asin(0.158 / raio);
    const travessa = new THREE.LatheGeometry(
      [
        [raio - 0.014, 0.71],
        [raio, 0.71],
        [raio, 0.79],
        [raio - 0.014, 0.79],
        [raio - 0.014, 0.71],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      16,
      Math.PI - meiaAbertura,
      meiaAbertura * 2,
    ).translate(0, 0, raio - 0.23);
    partes.push(uvEmMetros(travessa, REPETICAO.madeira, "x"));
    return juntar(partes);
  });
}

/** Contorno da mesa visto de cima, com a direção para fora em cada ponto e o comprimento andado. */
function contornoDaMesa(forma: Forma, folga: number) {
  const pontos: { x: number; z: number; nx: number; nz: number; s: number }[] = [];
  if (forma.redonda) {
    const r = forma.largura / 2 + folga;
    const lados = 72;
    for (let i = 0; i <= lados; i++) {
      const a = (i / lados) * Math.PI * 2;
      pontos.push({
        x: Math.sin(a) * r,
        z: Math.cos(a) * r,
        nx: Math.sin(a),
        nz: Math.cos(a),
        s: a * r,
      });
    }
    return pontos;
  }
  // Retângulo de cantos arredondados (a toalha dobra no canto).
  const canto = 0.035;
  const mx = forma.largura / 2 + folga - canto;
  const mz = forma.profundidade / 2 + folga - canto;
  const centros: [number, number, number][] = [
    [mx, mz, 0],
    [mx, -mz, Math.PI / 2],
    [-mx, -mz, Math.PI],
    [-mx, mz, (Math.PI * 3) / 2],
  ];
  let s = 0;
  let anterior: { x: number; z: number } | null = null;
  for (const [cx, cz, inicio] of centros) {
    for (let k = 0; k <= 6; k++) {
      const a = inicio + (k / 6) * (Math.PI / 2);
      const nx = Math.sin(a);
      const nz = Math.cos(a);
      const x = cx + nx * canto;
      const z = cz + nz * canto;
      if (anterior) s += Math.hypot(x - anterior.x, z - anterior.z);
      pontos.push({ x, z, nx, nz, s });
      anterior = { x, z };
    }
  }
  const primeiro = pontos[0];
  s += Math.hypot(
    primeiro.x - pontos[pontos.length - 1].x,
    primeiro.z - pontos[pontos.length - 1].z,
  );
  pontos.push({ ...primeiro, s });
  return pontos;
}

/**
 * Toalha sobre a mesa: o topo logo acima do tampo, a borda arredondada e a saia caindo até
 * BARRA_TOALHA, com ondas leves de pano na barra. Coordenada de textura em metros: o
 * xadrez fica do mesmo tamanho em todas as mesas.
 */
export function geometriaToalha(forma: Forma): THREE.BufferGeometry {
  const chave = `toalha:${forma.largura.toFixed(2)}:${forma.profundidade.toFixed(2)}:${forma.redonda}`;
  return lembrar(chave, () => {
    const topo = ALTURA_TOALHA;
    const t = REPETICAO.toalha;
    const contorno = contornoDaMesa(forma, 0.004);
    // Tampo de pano: o contorno preenchido, deitado no plano xz.
    const forma2d = new THREE.Shape(contorno.slice(0, -1).map((p) => new THREE.Vector2(p.x, -p.z)));
    const cima = new THREE.ShapeGeometry(forma2d, 4).rotateX(-Math.PI / 2).translate(0, topo, 0);
    uvEmMetros(cima, t);

    // Saia: perfil (afastamento para fora, altura) varrido pelo contorno.
    const perfil: [number, number][] = [
      [0, topo],
      [0.009, topo - 0.004],
      [0.015, topo - 0.014],
      [0.017, topo - 0.03],
      [0.019, BARRA_TOALHA + 0.05],
      [0.022, BARRA_TOALHA + 0.006],
      [0.02, BARRA_TOALHA],
    ];
    const posicoes: number[] = [];
    const uvs: number[] = [];
    for (const [d, y] of perfil) {
      // Quanto mais para baixo, mais a barra ondula (pano caindo).
      const queda = Math.max(0, (topo - 0.03 - y) / (topo - 0.03 - BARRA_TOALHA));
      for (const p of contorno) {
        const onda = Math.sin(p.s * 38) * 0.007 * queda + Math.sin(p.s * 13 + 1.3) * 0.004 * queda;
        const fora = d + onda;
        posicoes.push(p.x + p.nx * fora, y, p.z + p.nz * fora);
        uvs.push(p.s / t, (topo - y + 0.2) / t);
      }
    }
    const colunas = contorno.length;
    const indices: number[] = [];
    for (let i = 0; i < perfil.length - 1; i++) {
      for (let j = 0; j < colunas - 1; j++) {
        const a = i * colunas + j;
        const b = a + 1;
        const c = a + colunas;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const saia = new THREE.BufferGeometry();
    saia.setAttribute("position", new THREE.Float32BufferAttribute(posicoes, 3));
    saia.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    saia.setIndex(indices);
    saia.computeVertexNormals();
    return juntar([cima, saia]);
  });
}

export function geometriaMesa(forma: Forma): {
  tampo: THREE.BufferGeometry;
  pes: THREE.BufferGeometry;
  toalha: THREE.BufferGeometry;
} {
  const chave = `mesa:${forma.largura.toFixed(2)}:${forma.profundidade.toFixed(2)}:${forma.redonda}`;
  return lembrar(chave, () => {
    const espessura = 0.045;
    const y = ALTURA_TAMPO - espessura / 2;
    const toalha = geometriaToalha(forma);
    if (forma.redonda) {
      return {
        tampo: uvEmMetros(
          new THREE.CylinderGeometry(forma.largura / 2, forma.largura / 2, espessura, 48).translate(
            0,
            y,
            0,
          ),
          REPETICAO.madeira,
        ),
        pes: juntar([
          cilindro(0.045, ALTURA_TAMPO - espessura, 0, (ALTURA_TAMPO - espessura) / 2, 0),
          cilindro(0.24, 0.025, 0, 0.0125, 0, 32),
        ]),
        toalha,
      };
    }
    const meioX = forma.largura / 2 - 0.08;
    const meioZ = forma.profundidade / 2 - 0.08;
    const alturaPe = ALTURA_TAMPO - espessura;
    return {
      tampo: uvEmMetros(
        caixa(forma.largura, espessura, forma.profundidade, 0, y, 0),
        REPETICAO.madeira,
      ),
      pes: juntar([
        caixa(0.055, alturaPe, 0.055, -meioX, alturaPe / 2, -meioZ),
        caixa(0.055, alturaPe, 0.055, meioX, alturaPe / 2, -meioZ),
        caixa(0.055, alturaPe, 0.055, -meioX, alturaPe / 2, meioZ),
        caixa(0.055, alturaPe, 0.055, meioX, alturaPe / 2, meioZ),
        // Saia por baixo do tampo, como numa mesa de madeira de verdade.
        caixa(forma.largura - 0.16, 0.08, 0.025, 0, alturaPe - 0.04, -meioZ),
        caixa(forma.largura - 0.16, 0.08, 0.025, 0, alturaPe - 0.04, meioZ),
      ]),
      toalha,
    };
  });
}

/** Pessoa sentada na cadeira (a cadeira está na origem), com os braços apoiados na mesa. */
export function geometriaSentada(): { roupa: THREE.BufferGeometry; pele: THREE.BufferGeometry } {
  return lembrar("sentada", () => {
    const roupa: THREE.BufferGeometry[] = [];
    const pele: THREE.BufferGeometry[] = [];
    for (const lado of [-1, 1]) {
      roupa.push(capsula(0.078, 0.3, Math.PI / 2).translate(lado * 0.1, 0.55, 0.12)); // coxa
      roupa.push(capsula(0.066, 0.34).translate(lado * 0.1, 0.27, 0.3)); // canela
      roupa.push(caixa(0.095, 0.06, 0.21, lado * 0.1, 0.03, 0.36)); // sapato
      roupa.push(capsula(0.057, 0.2, -0.62).translate(lado * 0.22, 0.94, 0.09)); // braço
      roupa.push(capsula(0.052, 0.22, Math.PI / 2).translate(lado * 0.2, 0.805, 0.3)); // antebraço
      pele.push(esfera(0.05, lado * 0.19, 0.8, 0.47)); // mão
    }
    roupa.push(capsula(0.165, 0.3, 0.12).translate(0, 0.9, 0)); // tronco, inclinado para a mesa
    pele.push(cilindro(0.05, 0.09, 0, 1.17, 0.035)); // pescoço
    pele.push(
      new THREE.SphereGeometry(0.112, 24, 18).scale(0.9, 1.06, 0.95).translate(0, 1.3, 0.05),
    );
    return { roupa: juntar(roupa), pele: juntar(pele) };
  });
}

/** Garçom em pé, com avental e bandeja na mão direita. */
export function geometriaGarcom(): {
  roupa: THREE.BufferGeometry;
  pele: THREE.BufferGeometry;
  avental: THREE.BufferGeometry;
  bandeja: THREE.BufferGeometry;
} {
  return lembrar("garcom", () => {
    const roupa: THREE.BufferGeometry[] = [];
    for (const lado of [-1, 1]) {
      roupa.push(capsula(0.08, 0.66).translate(lado * 0.1, 0.44, 0)); // perna
      roupa.push(caixa(0.1, 0.07, 0.24, lado * 0.1, 0.035, 0.04)); // sapato
    }
    roupa.push(capsula(0.18, 0.36).translate(0, 1.2, 0)); // tronco
    roupa.push(capsula(0.06, 0.46, 0.08).translate(-0.27, 1.1, 0.02)); // braço esquerdo, solto
    roupa.push(capsula(0.06, 0.2).translate(0.27, 1.22, 0)); // braço direito
    roupa.push(capsula(0.055, 0.24, Math.PI / 2).translate(0.27, 1.06, 0.17)); // antebraço
    return {
      roupa: juntar(roupa),
      pele: juntar([
        cilindro(0.052, 0.09, 0, 1.52, 0),
        new THREE.SphereGeometry(0.114, 24, 18).scale(0.9, 1.06, 0.95).translate(0, 1.66, 0.01),
        esfera(0.052, -0.28, 0.82, 0.05),
        esfera(0.052, 0.27, 1.06, 0.33),
      ]),
      avental: caixa(0.36, 0.55, 0.02, 0, 0.78, 0.17),
      bandeja: cilindro(0.17, 0.014, 0.27, 1.1, 0.36, 32),
    };
  });
}

/** Caixas que a câmera desenha em volta de cada pessoa no modo "como a câmera vê". */
export function contornoPessoa(emPe: boolean): THREE.EdgesGeometry {
  return lembrar(`contorno:${emPe}`, () =>
    emPe
      ? new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 1.82, 0.5).translate(0, 0.91, 0.06))
      : new THREE.EdgesGeometry(new THREE.BoxGeometry(0.56, 1.44, 0.78).translate(0, 0.72, 0.16)),
  );
}

export function geometriaPrato(): THREE.BufferGeometry {
  return lembrar("prato", () => {
    // Perfil do prato girado em volta do eixo: fundo raso e aba levantada.
    const perfil = [
      new THREE.Vector2(0, 0.002),
      new THREE.Vector2(0.075, 0.002),
      new THREE.Vector2(0.09, 0.007),
      new THREE.Vector2(0.122, 0.017),
      new THREE.Vector2(0.126, 0.02),
      new THREE.Vector2(0.12, 0.021),
    ];
    return new THREE.LatheGeometry(perfil, 40);
  });
}

/** Taça de vinho: pé, haste fina e bojo aberto (perfil girado). */
export function geometriaCopo(): THREE.BufferGeometry {
  return lembrar("copo", () => {
    const perfil = [
      [0, 0.001],
      [0.031, 0.001],
      [0.032, 0.003],
      [0.028, 0.005],
      [0.008, 0.009],
      [0.0042, 0.018],
      [0.0038, 0.07],
      [0.006, 0.079],
      [0.016, 0.085],
      [0.029, 0.1],
      [0.037, 0.125],
      [0.036, 0.152],
      [0.032, 0.172],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(perfil, 24);
  });
}

/** O vinho (ou a água) dentro do bojo da taça. */
export function geometriaLiquido(): THREE.BufferGeometry {
  return lembrar("liquido", () => {
    const perfil = [
      [0, 0.087],
      [0.014, 0.0875],
      [0.026, 0.099],
      [0.032, 0.112],
      [0.0335, 0.12],
      [0, 0.12],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(perfil, 20);
  });
}

export function geometriaComida(): THREE.BufferGeometry {
  return lembrar("comida", () =>
    new THREE.SphereGeometry(0.075, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1),
  );
}

export function geometriaGuardanapo(): THREE.BufferGeometry {
  return lembrar("guardanapo", () => new THREE.IcosahedronGeometry(0.05, 1).scale(1.1, 0.45, 0.9));
}

export function geometriaCardapio(): THREE.BufferGeometry {
  return lembrar("cardapio", () => new THREE.BoxGeometry(0.2, 0.012, 0.28).translate(0, 0.006, 0));
}

/** Retângulo de cantos redondos deitado no chão: o "tapete" colorido do estado da mesa. */
export function formaTapete(meiaX: number, meiaZ: number, raio = 0.32): THREE.Shape {
  const forma = new THREE.Shape();
  const x0 = -meiaX;
  const z0 = -meiaZ;
  const x1 = meiaX;
  const z1 = meiaZ;
  forma.moveTo(x0 + raio, z0);
  forma.lineTo(x1 - raio, z0);
  forma.quadraticCurveTo(x1, z0, x1, z0 + raio);
  forma.lineTo(x1, z1 - raio);
  forma.quadraticCurveTo(x1, z1, x1 - raio, z1);
  forma.lineTo(x0 + raio, z1);
  forma.quadraticCurveTo(x0, z1, x0, z1 - raio);
  forma.lineTo(x0, z0 + raio);
  forma.quadraticCurveTo(x0, z0, x0 + raio, z0);
  return forma;
}
