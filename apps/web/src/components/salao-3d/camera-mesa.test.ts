import { describe, expect, it } from "vitest";

import type { Mesa } from "@/lib/tipos";

import { ALTURA_ALVO_MESA, enquadrarMesa } from "./camera-mesa";
import { ALTURA_TAMPO } from "./geometrias";
import { montarPlanta } from "./planta";

function mesa(numero: number, lugares: number, pos_x: number, pos_y: number): Mesa {
  return {
    id: numero,
    numero,
    lugares,
    pos_x,
    pos_y,
    ativa: true,
    estado: "livre",
    estado_desde: null,
    camera_id: null,
    poligono: null,
    sentou_em: null,
    atendida_em: null,
    saiu_em: null,
    pessoas: 0,
  };
}

const SALAO = montarPlanta([
  mesa(1, 2, 0, 0),
  mesa(2, 4, 3, 0),
  mesa(3, 6, 1, 1),
  mesa(4, 8, 0, 3),
  mesa(5, 10, 3, 3),
]);

describe("câmera indo até uma mesa", () => {
  it("mira o centro da mesa, na altura do tampo", () => {
    expect(ALTURA_ALVO_MESA).toBe(ALTURA_TAMPO);
    for (const item of SALAO.mesas) {
      const { alvo } = enquadrarMesa(item, SALAO);
      expect(alvo).toEqual([item.x, ALTURA_TAMPO, item.z]);
    }
  });

  it("fica a uns 5 m, do alto, de frente e pela direita", () => {
    for (const item of SALAO.mesas) {
      const { posicao, alvo } = enquadrarMesa(item, SALAO);
      const [dx, dy, dz] = posicao.map((v, i) => v - alvo[i]);
      expect(Math.hypot(dx, dy, dz)).toBeCloseTo(5);
      expect(dz).toBeGreaterThan(0); // de frente, como a vista inicial
      expect(dx).toBeGreaterThan(0); // pela direita
      expect(dz).toBeGreaterThan(dx); // mais de frente que de lado
      expect(dy).toBeGreaterThan(1.5); // de cima, sem ficar rente ao chão
      expect(dy).toBeLessThan(Math.hypot(dx, dz) * 1.5); // nem de cima demais: 3/4
    }
  });

  it("nunca fica atrás das paredes do fundo e da esquerda", () => {
    for (const opcoes of [{}, { giro: -2, elevacao: 0 }, { distancia: 30, giro: 9 }]) {
      for (const item of SALAO.mesas) {
        const { posicao } = enquadrarMesa(item, SALAO, opcoes);
        expect(posicao[0]).toBeGreaterThan(-SALAO.largura / 2);
        expect(posicao[2]).toBeGreaterThan(-SALAO.profundidade / 2);
        expect(posicao[1]).toBeGreaterThan(ALTURA_TAMPO);
      }
    }
  });

  it("a distância pode mudar", () => {
    const [item] = SALAO.mesas;
    const { posicao, alvo } = enquadrarMesa(item, SALAO, { distancia: 3 });
    expect(Math.hypot(...posicao.map((v, i) => v - alvo[i]))).toBeCloseTo(3);
  });
});
