import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { aces, antesDoAces, EXPOSICAO, type Rgb } from "./tom";

// Os tokens dos estados (globals.css), claro e escuro.
const TOKENS = [
  "#8a958f",
  "#c98f12",
  "#d2462e",
  "#2f5da8",
  "#7a3e8e",
  "#7f8c86",
  "#e0a82e",
  "#ef6a50",
  "#6d95dd",
  "#b27ac4",
  "#8fb2ee",
];

function linear(hex: string): Rgb {
  const c = new THREE.Color(hex); // o three guarda em RGB linear
  return [c.r, c.g, c.b];
}

describe("cor pré-corrigida para o tom ACES", () => {
  for (const hex of TOKENS) {
    it(`${hex} volta a ser ${hex} depois do tom`, () => {
      const alvo = linear(hex);
      const final = aces(antesDoAces(alvo, EXPOSICAO), EXPOSICAO);
      const tela = new THREE.Color(...final).getHexString();
      const esperado = new THREE.Color(hex);
      const obtido = new THREE.Color(`#${tela}`);
      // Diferença em sRGB, de 0 a 255 por canal.
      const diferenca = Math.max(
        ...(["r", "g", "b"] as const).map((k) =>
          Math.abs(
            obtido.clone().convertLinearToSRGB()[k] - esperado.clone().convertLinearToSRGB()[k],
          ),
        ),
      );
      expect(diferenca * 255).toBeLessThan(6);
    });
  }

  it("sem correção, o tom muda a cor do token (o motivo deste arquivo)", () => {
    const alvo = linear("#2f5da8");
    const sem = aces(alvo);
    expect(Math.abs(sem[2] - alvo[2])).toBeGreaterThan(0.03);
  });
});
