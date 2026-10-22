import { describe, expect, it } from "vitest";

import { concluir, gerarTextura, NOMES_TEXTURAS, toalhaEmFatias } from "./texturas-pbr";

/** Resumo curto dos bytes, para comparar duas gerações sem guardar a textura no teste. */
function impressao(bytes: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return h >>> 0;
}

describe("texturas geradas no código", () => {
  for (const nome of NOMES_TEXTURAS) {
    it(`${nome}: tem o tamanho pedido e sai igual toda vez`, () => {
      const a = concluir(gerarTextura(nome, 64));
      const b = concluir(gerarTextura(nome, 64));
      expect(a.tamanho).toBe(64);
      for (const mapa of [a.cor, a.normal, a.orm]) expect(mapa.length).toBe(64 * 64 * 4);
      expect(impressao(a.cor)).toBe(impressao(b.cor));
      expect(impressao(a.normal)).toBe(impressao(b.normal));
      expect(impressao(a.orm)).toBe(impressao(b.orm));
    });

    it(`${nome}: normal aponta para fora e nada é transparente`, () => {
      const { normal, cor, orm } = concluir(gerarTextura(nome, 32));
      for (let i = 0; i < normal.length; i += 4) {
        expect(normal[i + 2]).toBeGreaterThan(127); // z da normal sempre para fora da superfície
        expect(cor[i + 3]).toBe(255);
        expect(orm[i + 3]).toBe(255);
        expect(orm[i + 2]).toBe(0); // nada de metal
      }
    });
  }

  it("gera aos poucos: pausa várias vezes antes de terminar", () => {
    const geracao = gerarTextura("piso", 64);
    let pausas = 0;
    let passo = geracao.next();
    while (!passo.done) {
      pausas++;
      passo = geracao.next();
    }
    expect(pausas).toBeGreaterThan(4);
    expect(passo.value.tamanho).toBe(64);
  });

  it("toalha xadrez tem quadrados vermelhos e brancos", () => {
    const { cor, tamanho } = concluir(toalhaEmFatias(64));
    const pixel = (x: number, y: number) => {
      const i = (y * tamanho + x) * 4;
      return [cor[i], cor[i + 1], cor[i + 2]];
    };
    const [r1, g1] = pixel(2, 2); // quadrado branco (nenhuma faixa)
    const [r2, g2] = pixel(12, 12); // cruzamento das faixas: vermelho cheio
    expect(r1).toBeGreaterThan(180);
    expect(g1).toBeGreaterThan(170);
    expect(r2).toBeGreaterThan(120);
    expect(g2).toBeLessThan(50);
  });

  it("gera as texturas de 512 px em tempo razoável", () => {
    const inicio = performance.now();
    for (const nome of NOMES_TEXTURAS) concluir(gerarTextura(nome, 512));
    expect(performance.now() - inicio).toBeLessThan(15_000);
  });
});
