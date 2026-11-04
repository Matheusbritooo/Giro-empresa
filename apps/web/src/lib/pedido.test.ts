import { describe, expect, it } from "vitest";

import {
  adicionar,
  campoDosCentavos,
  centavosDoCampo,
  itensParaEscolher,
  lancamentosDaCozinha,
  preco,
  quantidadeNoRascunho,
  situacaoDoItem,
  tirar,
  totalDoRascunho,
} from "./pedido";
import type { Cardapio, ItemCozinha } from "./tipos";

const CARDAPIO: Cardapio = {
  categorias: [
    { id: 1, nome: "Massas", ordem: 0, bebida: false, ativa: true },
    { id: 2, nome: "Bebidas", ordem: 1, bebida: true, ativa: true },
    { id: 3, nome: "Pizzas", ordem: 2, bebida: false, ativa: false },
  ],
  itens: [
    {
      id: 10,
      categoria_id: 1,
      nome: "Lasanha à bolonhesa",
      descricao: null,
      preco_centavos: 6200,
      custo_centavos: null,
      ativo: true,
      disponivel: true,
    },
    {
      id: 11,
      categoria_id: 1,
      nome: "Nhoque da casa",
      descricao: null,
      preco_centavos: 5400,
      custo_centavos: null,
      ativo: true,
      disponivel: false,
    },
    {
      id: 12,
      categoria_id: 1,
      nome: "Fettuccine Alfredo",
      descricao: null,
      preco_centavos: 5800,
      custo_centavos: null,
      ativo: false,
      disponivel: true,
    },
    {
      id: 20,
      categoria_id: 2,
      nome: "Refrigerante lata",
      descricao: null,
      preco_centavos: 700,
      custo_centavos: null,
      ativo: true,
      disponivel: true,
    },
    {
      id: 30,
      categoria_id: 3,
      nome: "Pizza margherita",
      descricao: null,
      preco_centavos: 6400,
      custo_centavos: null,
      ativo: true,
      disponivel: true,
    },
  ],
  mostra_custo: false,
  mais_pedidos: [20, 12, 10],
};

describe("pedido na mesa", () => {
  it("mostra os mais pedidos primeiro, sem o que saiu do cardápio", () => {
    expect(itensParaEscolher(CARDAPIO, "mais", "").map((i) => i.id)).toEqual([20, 10]);
    expect(
      itensParaEscolher({ ...CARDAPIO, mais_pedidos: [] }, "mais", "").map((i) => i.id),
    ).toEqual([10, 11, 20]);
  });

  it("filtra por categoria e busca sem acento em todo o cardápio ativo", () => {
    expect(itensParaEscolher(CARDAPIO, 1, "").map((i) => i.id)).toEqual([10, 11]);
    expect(itensParaEscolher(CARDAPIO, 2, "lasanha").map((i) => i.id)).toEqual([10]);
    expect(itensParaEscolher(CARDAPIO, "mais", "BOLONHESA").map((i) => i.id)).toEqual([10]);
    expect(itensParaEscolher(CARDAPIO, "mais", "pizza")).toEqual([]); // categoria desativada
  });

  it("monta o rascunho tocando nos itens", () => {
    let r = adicionar([], 10);
    r = adicionar(r, 20);
    r = adicionar(r, 10);
    expect(r).toEqual([
      { itemId: 10, quantidade: 2, observacao: "" },
      { itemId: 20, quantidade: 1, observacao: "" },
    ]);
    expect(quantidadeNoRascunho(r)).toBe(3);
    expect(totalDoRascunho(r, CARDAPIO.itens)).toBe(2 * 6200 + 700);
    r = tirar(tirar(r, 20), 10);
    expect(r).toEqual([{ itemId: 10, quantidade: 1, observacao: "" }]);
  });

  it("formata preço e lê o campo de reais", () => {
    expect(preco(6200)).toBe("R$ 62");
    expect(preco(1250)).toBe("R$ 12,50");
    expect(preco(890000)).toBe("R$ 8.900");
    expect(centavosDoCampo("12,50")).toBe(1250);
    expect(centavosDoCampo("R$ 62")).toBe(6200);
    expect(centavosDoCampo("1.200")).toBe(120000);
    expect(centavosDoCampo("doze")).toBeNull();
    expect(campoDosCentavos(1250)).toBe("12,50");
    expect(campoDosCentavos(6200)).toBe("62");
    expect(campoDosCentavos(null)).toBe("");
  });
});

describe("cozinha", () => {
  const item = (
    id: number,
    mesa: number,
    lancado: string,
    extra: Partial<ItemCozinha> = {},
  ): ItemCozinha => ({
    id,
    mesa_id: mesa * 10,
    mesa_numero: mesa,
    ocupacao_id: 1,
    item_id: 10,
    nome: "Lasanha",
    preco_unit_centavos: 6200,
    quantidade: 1,
    observacao: null,
    lancado_em: lancado,
    pronto_em: null,
    cancelado_em: null,
    motivo_cancelamento: null,
    ...extra,
  });

  it("agrupa por lançamento, do mais antigo para o mais novo", () => {
    const grupos = lancamentosDaCozinha([
      item(3, 7, "2026-10-16T23:05:00Z"),
      item(1, 4, "2026-10-16T23:01:00Z"),
      item(2, 4, "2026-10-16T23:01:00Z"),
      item(4, 4, "2026-10-16T23:09:00Z"),
    ]);
    expect(grupos.map((g) => [g.mesaNumero, g.itens.map((i) => i.id)])).toEqual([
      [4, [1, 2]],
      [7, [3]],
      [4, [4]],
    ]);
  });

  it("diz em que pé está cada item", () => {
    expect(situacaoDoItem(item(1, 4, "x"))).toBe("na_cozinha");
    expect(situacaoDoItem(item(1, 4, "x", { pronto_em: "y" }))).toBe("pronto");
    expect(situacaoDoItem(item(1, 4, "x", { pronto_em: "y", cancelado_em: "z" }))).toBe(
      "cancelado",
    );
  });
});
