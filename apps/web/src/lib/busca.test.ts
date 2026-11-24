import { describe, expect, it } from "vitest";

import { buscar, comRestauranteNoLink, normalizar } from "./busca";
import type { Cardapio, Insumo, Mesa } from "./tipos";

const mesa = (id: number, numero: number, estado: Mesa["estado"] = "livre") =>
  ({ id, numero, estado, lugares: 4 }) as Mesa;

const FONTES = {
  mesas: [mesa(1, 1), mesa(7, 7, "ocupada"), mesa(17, 17)],
  cardapio: {
    categorias: [{ id: 1, nome: "Massas", ordem: 0, bebida: false, ativa: true }],
    itens: [
      {
        id: 10,
        categoria_id: 1,
        nome: "Lasanha à bolonhesa",
        preco_centavos: 6200,
        ativo: true,
        disponivel: true,
      },
      {
        id: 11,
        categoria_id: 1,
        nome: "Nhoque",
        preco_centavos: 4800,
        ativo: true,
        disponivel: false,
      },
      {
        id: 12,
        categoria_id: 1,
        nome: "Lasanha velha",
        preco_centavos: 1000,
        ativo: false,
        disponivel: true,
      },
    ],
    mostra_custo: false,
    mais_pedidos: [],
  } as unknown as Cardapio,
  insumos: [
    { id: 3, nome: "Muçarela", unidade: "g", saldo: 3250, ativo: true },
    { id: 4, nome: "Massa de lasanha", unidade: "g", saldo: 800, ativo: true },
  ] as Insumo[],
};

const titulos = (texto: string, papel: Parameters<typeof buscar>[2] = "dono") =>
  buscar(texto, FONTES, papel).map((r) => r.titulo);

describe("busca de qualquer tela", () => {
  it("acha a mesa pelo número, do jeito que a pessoa digita", () => {
    expect(titulos("7")[0]).toBe("Mesa 7");
    expect(titulos("mesa 7")[0]).toBe("Mesa 7");
    expect(titulos("m17")[0]).toBe("Mesa 17");
    expect(buscar("7", FONTES, "dono")[0]).toEqual({
      tipo: "mesa",
      titulo: "Mesa 7",
      detalhe: "Ocupada, 4 lugares",
      href: "/pedido?mesa=7",
    });
  });

  it("acha prato e ingrediente sem acento, e não mostra o que saiu do cardápio", () => {
    expect(titulos("mucarela")).toEqual(["Muçarela"]);
    expect(titulos("lasanha")).toEqual(["Lasanha à bolonhesa", "Massa de lasanha"]);
    expect(buscar("nhoque", FONTES, "dono")[0].detalhe).toBe("Massas, acabou hoje");
    expect(buscar("muc", FONTES, "dono")[0].detalhe).toBe("Estoque, tem 3,25 kg");
    const zerado = { ...FONTES, insumos: [{ ...FONTES.insumos[0], saldo: 0 }] };
    expect(buscar("muc", zerado, "dono")[0].detalhe).toBe("Estoque, zerado pela conta");
  });

  it("acha telas pelo nome ou pelo assunto, só as que o perfil abre", () => {
    expect(titulos("ajus")).toEqual(["Ajustes"]);
    expect(titulos("contador")).toEqual(["Relatório do mês"]);
    expect(titulos("cmv")).toEqual(["Perdas do estoque"]);
    expect(titulos("cmv", "gerente")).toEqual([]);
    expect(titulos("ajustes", "equipe")).toEqual([]);
    expect(titulos("cozinha", "equipe")).toEqual(["Cozinha"]);
  });

  it("textos de apoio", () => {
    expect(normalizar("  Pão de Alho ")).toBe("pao de alho");
    expect(buscar("   ", FONTES, "dono")).toEqual([]);
    expect(comRestauranteNoLink("/pedido?mesa=7", "2")).toBe("/pedido?mesa=7&restaurante=2");
    expect(comRestauranteNoLink("/estoque", null)).toBe("/estoque");
  });
});
