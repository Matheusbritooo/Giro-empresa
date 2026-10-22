/**
 * Formas do salão montadas com peças simples (caixa, cilindro, cápsula) e juntadas numa
 * geometria só por material. Uma cadeira vira um desenho só para a placa de vídeo, não dez.
 * Tudo olha para +z: a cadeira tem o encosto em -z e a pessoa olha para +z.
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
  const junta = mergeGeometries(partes);
  for (const parte of partes) parte.dispose();
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

export function geometriaCadeira(): THREE.BufferGeometry {
  return lembrar("cadeira", () => {
    const partes: THREE.BufferGeometry[] = [caixa(0.43, 0.045, 0.42, 0, 0.455, 0)];
    for (const x of [-0.18, 0.18]) {
      for (const z of [-0.17, 0.17]) partes.push(cilindro(0.019, 0.45, x, 0.225, z, 10));
      partes.push(caixa(0.032, 0.48, 0.032, x, 0.72, -0.19)); // montantes do encosto
    }
    partes.push(caixa(0.42, 0.075, 0.026, 0, 0.93, -0.19)); // travessa de cima
    partes.push(caixa(0.36, 0.035, 0.022, 0, 0.74, -0.19)); // travessa do meio
    return juntar(partes);
  });
}

export function geometriaMesa(forma: Forma): {
  tampo: THREE.BufferGeometry;
  pes: THREE.BufferGeometry;
} {
  const chave = `mesa:${forma.largura.toFixed(2)}:${forma.profundidade.toFixed(2)}:${forma.redonda}`;
  return lembrar(chave, () => {
    const espessura = 0.045;
    const y = ALTURA_TAMPO - espessura / 2;
    if (forma.redonda) {
      return {
        tampo: new THREE.CylinderGeometry(
          forma.largura / 2,
          forma.largura / 2,
          espessura,
          48,
        ).translate(0, y, 0),
        pes: juntar([
          cilindro(0.045, ALTURA_TAMPO - espessura, 0, (ALTURA_TAMPO - espessura) / 2, 0),
          cilindro(0.24, 0.025, 0, 0.0125, 0, 32),
        ]),
      };
    }
    const meioX = forma.largura / 2 - 0.08;
    const meioZ = forma.profundidade / 2 - 0.08;
    const alturaPe = ALTURA_TAMPO - espessura;
    return {
      tampo: caixa(forma.largura, espessura, forma.profundidade, 0, y, 0),
      pes: juntar([
        caixa(0.055, alturaPe, 0.055, -meioX, alturaPe / 2, -meioZ),
        caixa(0.055, alturaPe, 0.055, meioX, alturaPe / 2, -meioZ),
        caixa(0.055, alturaPe, 0.055, -meioX, alturaPe / 2, meioZ),
        caixa(0.055, alturaPe, 0.055, meioX, alturaPe / 2, meioZ),
        // Saia por baixo do tampo, como numa mesa de madeira de verdade.
        caixa(forma.largura - 0.16, 0.08, 0.025, 0, alturaPe - 0.04, -meioZ),
        caixa(forma.largura - 0.16, 0.08, 0.025, 0, alturaPe - 0.04, meioZ),
      ]),
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

export function geometriaCopo(): THREE.BufferGeometry {
  return lembrar("copo", () =>
    new THREE.CylinderGeometry(0.036, 0.03, 0.12, 20, 1, true).translate(0, 0.06, 0),
  );
}

export function geometriaLiquido(): THREE.BufferGeometry {
  return lembrar("liquido", () =>
    new THREE.CylinderGeometry(0.031, 0.029, 0.055, 20).translate(0, 0.03, 0),
  );
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
