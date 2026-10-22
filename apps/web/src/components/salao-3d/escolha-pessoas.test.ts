import { describe, expect, it } from "vitest";

import type { Mesa } from "@/lib/tipos";

import {
  ALCANCE_DOS_PES,
  type ClienteParaEscolha,
  escolherPessoas,
  folgaDosLados,
  giroParaCaber,
  resumo,
} from "./escolha-pessoas";
import { MANIFESTO } from "./modelos";
import { montarPlanta } from "./planta";

function mesa(numero: number, lugares: number, pos_x: number, pos_y: number): Mesa {
  return {
    id: numero,
    numero,
    lugares,
    pos_x,
    pos_y,
    ativa: true,
    estado: "ocupada",
    estado_desde: null,
    camera_id: null,
    poligono: null,
    sentou_em: "2026-10-22T20:15:00Z",
    atendida_em: null,
    saiu_em: null,
    pessoas: lugares,
  };
}

const PLANTA = montarPlanta([
  mesa(1, 2, 0, 0),
  mesa(3, 4, 1, 0),
  mesa(7, 6, 2, 0),
  mesa(13, 8, 0, 1),
  mesa(20, 10, 1, 1),
]);
const item = (id: number) => PLANTA.mesas.find((m) => m.mesa.id === id)!;
const CLIENTES: ClienteParaEscolha[] = MANIFESTO.clientes;

describe("escolha das pessoas sentadas", () => {
  it("o manifesto tem 6 clientes com 3 poses cada", () => {
    expect(CLIENTES).toHaveLength(6);
    for (const c of CLIENTES) expect(c.poses).toHaveLength(3);
  });

  it("a mesma visita mostra sempre as mesmas pessoas", () => {
    const a = escolherPessoas(item(7), 5, "2026-10-22T20:15:00Z", CLIENTES);
    const b = escolherPessoas(item(7), 5, "2026-10-22T20:15:00Z", CLIENTES);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
  });

  it("quem já estava sentado não muda quando chega mais gente na mesma visita", () => {
    const tres = escolherPessoas(item(13), 3, "2026-10-22T21:00:00Z", CLIENTES);
    const cinco = escolherPessoas(item(13), 5, "2026-10-22T21:00:00Z", CLIENTES);
    expect(cinco.slice(0, 3)).toEqual(tres);
  });

  it("uma visita nova muda as pessoas", () => {
    const primeira = escolherPessoas(item(3), 4, "2026-10-22T19:00:00Z", CLIENTES);
    const outras = ["19:40", "20:05", "20:30", "21:10", "21:45"].map((h) =>
      escolherPessoas(item(3), 4, `2026-10-22T${h}:00Z`, CLIENTES),
    );
    const iguais = (x: typeof primeira, y: typeof primeira) =>
      x.every((p, i) => p.cliente === y[i].cliente && p.pose === y[i].pose);
    expect(outras.some((o) => !iguais(o, primeira))).toBe(true);
    // E mesas diferentes na mesma hora também não ficam iguais.
    const mesa1 = escolherPessoas(item(1), 2, "2026-10-22T19:00:00Z", CLIENTES);
    const mesa3 = escolherPessoas(item(3), 2, "2026-10-22T19:00:00Z", CLIENTES);
    expect(iguais(mesa1, mesa3)).toBe(false);
  });

  it("ninguém se repete numa mesa de até 6 e todo cliente e pose existem", () => {
    for (const id of [1, 3, 7]) {
      for (const hora of ["18:00", "19:30", "22:10"]) {
        const pessoas = escolherPessoas(item(id), 6, `2026-10-22T${hora}:00Z`, CLIENTES);
        expect(new Set(pessoas.map((p) => p.cliente)).size).toBe(pessoas.length);
        for (const p of pessoas) {
          const cliente = CLIENTES.find((c) => c.id === p.cliente);
          expect(cliente?.poses).toContain(p.pose);
          expect(p.fase).toBeGreaterThanOrEqual(0);
          expect(p.fase).toBeLessThan(Math.PI * 2);
        }
      }
    }
  });

  it("mesa de 10 repete cliente só depois de usar os 6", () => {
    const pessoas = escolherPessoas(item(20), 10, "2026-10-22T20:00:00Z", CLIENTES);
    expect(pessoas).toHaveLength(10);
    expect(new Set(pessoas.slice(0, 6).map((p) => p.cliente)).size).toBe(6);
  });

  it("nunca passa do número de cadeiras nem de clientes vazios", () => {
    expect(escolherPessoas(item(1), 5, null, CLIENTES)).toHaveLength(2);
    expect(escolherPessoas(item(1), 2, null, [])).toEqual([]);
  });

  it("o resumo é estável (o mesmo número em qualquer aparelho)", () => {
    expect(resumo("")).toBe(0x811c9dc5);
    expect(resumo("7|0|2026-10-22T20:15:00Z")).toBe(resumo("7|0|2026-10-22T20:15:00Z"));
    expect(resumo("a")).not.toBe(resumo("b"));
  });
});

describe("pés de quem senta e os pés da mesa", () => {
  it("mesa redonda não tem pé no caminho", () => {
    const folga = folgaDosLados(item(1), 0);
    expect(folga.xMais).toBe(Number.POSITIVE_INFINITY);
    expect(folga.xMenos).toBe(Number.POSITIVE_INFINITY);
  });

  it("mesa comprida: o pé cruzado vai para o meio da mesa, não para a ponta", () => {
    const m = item(7);
    // Assentos 0 e 1 ficam fora do centro da mesa: um lado tem o pé da mesa perto.
    for (const i of [0, 1, 2, 3]) {
      const { xMais, xMenos } = folgaDosLados(m, i);
      expect(Math.abs(xMais - xMenos)).toBeGreaterThan(0.3);
    }
    for (let k = 0; k < 20; k++) {
      const pessoas = escolherPessoas(
        m,
        4,
        `2026-10-22T20:${String(k).padStart(2, "0")}:00Z`,
        CLIENTES,
      );
      pessoas.forEach((p, i) => {
        const { xMais, xMenos } = folgaDosLados(m, i);
        expect(p.espelhar).toBe(xMenos > xMais);
        expect(p.giro).toBe(0); // do lado do meio sobra espaço até para a perna cruzada
      });
    }
  });

  it("onde é apertado, quem cruza a perna gira um pouco na cadeira e o pé não bate na mesa", () => {
    for (const id of [3, 7, 13]) {
      const m = item(id);
      for (let k = 0; k < 30; k++) {
        const pessoas = escolherPessoas(m, m.assentos.length, `visita-${k}`, CLIENTES);
        pessoas.forEach((p, i) => {
          const folgas = folgaDosLados(m, i);
          const folga = p.espelhar ? folgas.xMenos : folgas.xMais;
          const sexo = CLIENTES.find((c) => c.id === p.cliente)!.sexo;
          const theta = -p.giro;
          expect(theta).toBeGreaterThanOrEqual(0);
          expect(theta).toBeLessThanOrEqual(0.25);
          const pe = ALCANCE_DOS_PES[sexo] * Math.cos(theta) - 0.45 * Math.sin(theta);
          expect(pe).toBeLessThanOrEqual(folga + 1e-9);
        });
      }
    }
  });

  it("homem não precisa girar; mulher gira menos de 15 graus na mesa de 4", () => {
    const folga = folgaDosLados(item(3), 0).xMais;
    expect(giroParaCaber(ALCANCE_DOS_PES.M, folga)).toBe(0);
    const giro = giroParaCaber(ALCANCE_DOS_PES.F, folga);
    expect(giro).toBeLessThan(0);
    expect(-giro).toBeLessThan((15 * Math.PI) / 180);
  });
});
