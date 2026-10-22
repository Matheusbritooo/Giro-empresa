import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { geometriaPrato } from "./geometrias";

describe("louça", () => {
  it("o fundo do prato olha para cima (senão, de cima, só aparece a borda)", () => {
    const g = geometriaPrato();
    const pos = g.getAttribute("position");
    const indice = g.getIndex();
    expect(indice).not.toBeNull();
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let paraCima = 0;
    let paraBaixo = 0;
    for (let t = 0; t < (indice?.count ?? 0); t += 3) {
      a.fromBufferAttribute(pos, indice?.getX(t) ?? 0);
      b.fromBufferAttribute(pos, indice?.getX(t + 1) ?? 0);
      c.fromBufferAttribute(pos, indice?.getX(t + 2) ?? 0);
      if (Math.max(a.y, b.y, c.y) > 0.0025) continue; // só os triângulos do fundo
      // Mesma conta do three para a face da frente: (c - b) x (a - b).
      const normal = new THREE.Vector3()
        .subVectors(c, b)
        .cross(new THREE.Vector3().subVectors(a, b));
      if (normal.lengthSq() < 1e-12) continue; // triângulo degenerado no centro
      if (normal.y > 0) paraCima++;
      else paraBaixo++;
    }
    expect(paraCima).toBeGreaterThan(0);
    expect(paraBaixo).toBe(0);
  });
});
