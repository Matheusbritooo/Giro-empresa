import { describe, expect, it } from "vitest";

import type { Mesa } from "@/lib/tipos";

import { assentosDaMesa, formaDaMesa, lugarNaMesa, montarPlanta } from "./planta";

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

// A Cantina do Marcos, como no seed: 14 mesas numa grade de 4 colunas.
const CANTINA = [
  mesa(1, 2, 0, 0),
  mesa(2, 2, 1, 0),
  mesa(3, 4, 2, 0),
  mesa(4, 4, 3, 0),
  mesa(5, 4, 0, 1),
  mesa(6, 4, 1, 1),
  mesa(7, 6, 2, 1),
  mesa(8, 4, 3, 1),
  mesa(9, 4, 0, 2),
  mesa(10, 4, 1, 2),
  mesa(11, 2, 2, 2),
  mesa(12, 2, 3, 2),
  mesa(13, 8, 0, 3),
  mesa(14, 6, 2, 3),
];

function seSobrepoem(a: ReturnType<typeof montarPlanta>["mesas"][number], b: typeof a) {
  return (
    Math.abs(a.x - b.x) < a.meiaPegada.x + b.meiaPegada.x &&
    Math.abs(a.z - b.z) < a.meiaPegada.z + b.meiaPegada.z
  );
}

describe("assentos em volta da mesa", () => {
  it("tem uma cadeira para cada lugar", () => {
    for (let lugares = 1; lugares <= 12; lugares++) {
      expect(assentosDaMesa(formaDaMesa(lugares), lugares)).toHaveLength(lugares);
    }
  });

  it("os dois primeiros a sentar ficam frente a frente", () => {
    for (const lugares of [2, 4, 6, 8]) {
      const [a, b] = assentosDaMesa(formaDaMesa(lugares), lugares);
      expect(Math.abs(Math.abs(a.rotacao - b.rotacao) - Math.PI)).toBeLessThan(1e-9);
      expect(a.x).toBeCloseTo(b.x);
    }
  });

  it("toda cadeira olha para a mesa", () => {
    for (const lugares of [2, 4, 6, 8, 10]) {
      for (const assento of assentosDaMesa(formaDaMesa(lugares), lugares)) {
        const prato = lugarNaMesa(assento);
        // Andar na direção em que a cadeira olha aproxima do centro da mesa.
        expect(Math.hypot(prato.x, prato.z)).toBeLessThan(Math.hypot(assento.x, assento.z));
      }
    }
  });
});

describe("salão montado a partir da planta", () => {
  it("nenhuma mesa encosta na outra, contando as cadeiras", () => {
    const { mesas } = montarPlanta(CANTINA);
    for (let i = 0; i < mesas.length; i++) {
      for (let j = i + 1; j < mesas.length; j++) {
        expect(seSobrepoem(mesas[i], mesas[j]), `mesas ${i + 1} e ${j + 1}`).toBe(false);
      }
    }
  });

  it("mesas grandes lado a lado ganham espaço", () => {
    const { mesas } = montarPlanta([mesa(1, 10, 0, 0), mesa(2, 10, 1, 0), mesa(3, 10, 0, 1)]);
    expect(seSobrepoem(mesas[0], mesas[1])).toBe(false);
    expect(seSobrepoem(mesas[0], mesas[2])).toBe(false);
  });

  it("o piso centrado na origem cabe todas as mesas com corredor até a parede", () => {
    const planta = montarPlanta(CANTINA);
    for (const m of planta.mesas) {
      expect(Math.abs(m.x) + m.meiaPegada.x).toBeLessThan(planta.largura / 2 - 1);
      expect(Math.abs(m.z) + m.meiaPegada.z).toBeLessThan(planta.profundidade / 2 - 1);
    }
  });

  it("salão sem mesas ainda tem piso", () => {
    const planta = montarPlanta([]);
    expect(planta.mesas).toEqual([]);
    expect(planta.largura).toBeGreaterThan(0);
  });
});
