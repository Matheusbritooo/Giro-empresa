import { describe, expect, it } from "vitest";

import {
  baseDoCampo,
  campoDaBase,
  custoDaFicha,
  ordenarInsumos,
  plural,
  porPorcao,
  precoDoInsumo,
  quando,
  quantidade,
  sugestoesDeAcabou,
  textoAteQuando,
  textoCompra,
  textoDaDiferenca,
  textoDaLista,
  textoDoMovimento,
} from "./estoque";
import type { Ficha, Insumo, ItemCardapio, LinhaDeCompra, ListaDeCompras } from "./tipos";

function insumo(
  id: number,
  nome: string,
  unidade: Insumo["unidade"],
  saldo: number,
  custo: number | null,
): Insumo {
  return {
    id,
    nome,
    unidade,
    embalagem_quantidade: 1000,
    embalagem_nome: null,
    onde_compra: null,
    custo_centavos: custo,
    saldo,
    ativo: true,
    situacao: null,
    acaba_em: null,
  };
}

const MASSA = insumo(1, "Massa de lasanha", "g", 0, 1800);
const CARNE = insumo(2, "Carne moída", "g", 4000, 3800);
const CHOPP = insumo(3, "Chopp", "ml", 21_000, 1333);
const REFRI = insumo(4, "Refrigerante lata", "un", 24, 260);

function item(id: number, nome: string, disponivel = true): ItemCardapio {
  return {
    id,
    categoria_id: 1,
    nome,
    descricao: null,
    preco_centavos: 6200,
    custo_centavos: null,
    ativo: true,
    disponivel,
    custo_pela_ficha: true,
  };
}

const LASANHA = item(10, "Lasanha à bolonhesa");
const POLPETTONE = item(11, "Polpettone recheado", false);
const FICHAS: Ficha[] = [
  {
    item_id: 10,
    linhas: [
      { insumo_id: 1, quantidade: 120 },
      { insumo_id: 2, quantidade: 120 },
    ],
    custo_outros_centavos: null,
    custo_centavos: null,
  },
  {
    item_id: 11,
    linhas: [{ insumo_id: 2, quantidade: 220 }],
    custo_outros_centavos: null,
    custo_centavos: null,
  },
];

describe("quantidades", () => {
  it("lê em kg, g, L, ml e unidades", () => {
    expect(quantidade("g", 3250)).toBe("3,25 kg");
    expect(quantidade("g", 800)).toBe("800 g");
    expect(quantidade("ml", 30_000)).toBe("30 L");
    expect(quantidade("ml", 300)).toBe("300 ml");
    expect(quantidade("un", 1)).toBe("1 unidade");
    expect(quantidade("un", 12)).toBe("12 unidades");
    expect(porPorcao("g", 120)).toBe("120 g");
  });

  it("o campo em kg ou L vira a unidade base e volta", () => {
    expect(baseDoCampo("g", "3,5")).toBe(3500);
    expect(baseDoCampo("ml", "0.3")).toBe(300);
    expect(baseDoCampo("g", "2")).toBe(2000);
    expect(baseDoCampo("un", "12")).toBe(12);
    expect(baseDoCampo("un", "1,5")).toBeNull();
    expect(baseDoCampo("g", "dois")).toBeNull();
    expect(campoDaBase("g", 3500)).toBe("3,5");
    expect(campoDaBase("un", 24)).toBe("24");
  });

  it("preço como se compra", () => {
    expect(precoDoInsumo(CARNE)).toBe("R$ 38/kg");
    expect(precoDoInsumo(CHOPP)).toBe("R$ 13,33/L");
    expect(precoDoInsumo(REFRI)).toBe("R$ 2,60 a unidade");
    expect(precoDoInsumo({ ...REFRI, custo_centavos: null })).toBeNull();
  });
});

describe("lista e sugestões", () => {
  it("zerados primeiro, depois pelo nome", () => {
    expect(ordenarInsumos([REFRI, CHOPP, MASSA, CARNE]).map((i) => i.nome)).toEqual([
      "Massa de lasanha",
      "Carne moída",
      "Chopp",
      "Refrigerante lata",
    ]);
  });

  it("sugere marcar acabou só nos pratos que ainda estão com 'tem hoje'", () => {
    const zerada = { ...CARNE, saldo: -200 };
    const sugestoes = sugestoesDeAcabou([MASSA, zerada, CHOPP], FICHAS, [LASANHA, POLPETTONE]);
    expect(sugestoes.map((s) => [s.insumo.nome, s.pratos.map((p) => p.nome)])).toEqual([
      ["Massa de lasanha", ["Lasanha à bolonhesa"]],
      ["Carne moída", ["Lasanha à bolonhesa"]], // o polpettone já está como acabou
    ]);
    expect(sugestoesDeAcabou([{ ...MASSA, ativo: false }], FICHAS, [LASANHA])).toEqual([]);
  });
});

describe("custo pela ficha", () => {
  it("soma ingredientes e outros, como o servidor", () => {
    // 120 g a R$ 18/kg (2,16) + 120 g a R$ 38/kg (4,56) + R$ 3,50 = R$ 10,22.
    expect(custoDaFicha(FICHAS[0].linhas, [MASSA, CARNE], 350)).toBe(1022);
    // 300 ml a R$ 13,33/L = 399,9 centavos.
    expect(custoDaFicha([{ insumo_id: 3, quantidade: 300 }], [CHOPP], null)).toBe(400);
    // Meio centavo vai para o par, como no Python: 1704,5 vira 1704.
    expect(
      custoDaFicha([{ insumo_id: 4, quantidade: 1 }], [{ ...REFRI, custo_centavos: 1354.5 }], 350),
    ).toBe(1704);
    expect(custoDaFicha([], [MASSA], 350)).toBeNull();
    expect(
      custoDaFicha(FICHAS[0].linhas, [{ ...MASSA, custo_centavos: null }, CARNE], 0),
    ).toBeNull();
  });
});

describe("textos", () => {
  it("contagem e livro", () => {
    const d = {
      insumo_id: 2,
      nome: "Muçarela",
      unidade: "g" as const,
      antes: 3000,
      contado: 2500,
      diferenca: -500,
    };
    expect(textoDaDiferenca(d)).toBe("Muçarela: 500 g a menos que a conta.");
    expect(textoDaDiferenca({ ...d, contado: 3000, diferenca: 0 })).toBe(
      "Muçarela: bateu com a conta.",
    );
    expect(textoDaDiferenca({ ...d, contado: 4500, diferenca: 1500 })).toBe(
      "Muçarela: 1,5 kg a mais que a conta.",
    );

    const m = {
      id: 1,
      quantidade: -120,
      saldo_depois: 4880,
      valor_centavos: null,
      quem: null,
      em: "",
      motivo: null,
      prato: "Lasanha à bolonhesa",
    };
    expect(textoDoMovimento({ ...m, tipo: "venda" })).toBe("Pedido: Lasanha à bolonhesa");
    expect(textoDoMovimento({ ...m, tipo: "venda", prato: null })).toBe("Vendas da noite");
    expect(textoDoMovimento({ ...m, tipo: "perda", motivo: "Estragou" })).toBe("Perda: Estragou");
    expect(textoDoMovimento({ ...m, tipo: "contagem", quantidade: 0 })).toBe("Contagem: bateu");
  });
});

describe("previsão e lista de compras", () => {
  it("o urgente vem primeiro, depois o que entra na compra", () => {
    const lista = ordenarInsumos([
      { ...REFRI, situacao: "tem" },
      { ...CHOPP, situacao: "comprar" },
      { ...CARNE, situacao: "vai_faltar" },
    ]);
    expect(lista.map((i) => i.nome)).toEqual(["Carne moída", "Chopp", "Refrigerante lata"]);
  });

  it("até quando dá, contado a partir de hoje (quarta, 04/11)", () => {
    expect(quando("2026-11-04", "2026-11-04")).toBe("hoje");
    expect(quando("2026-11-05", "2026-11-04")).toBe("amanhã");
    expect(quando("2026-11-06", "2026-11-04")).toBe("na sexta");
    expect(quando("2026-11-07", "2026-11-04")).toBe("no sábado");
    expect(textoAteQuando({ ...CARNE, acaba_em: "2026-11-05" }, "2026-11-04")).toBe("acaba amanhã");
    expect(textoAteQuando(CARNE, "2026-11-04")).toBe("dá a semana toda");
    expect(textoAteQuando(MASSA, "2026-11-04")).toBe("não tem");
  });

  it("o que pedir ao fornecedor", () => {
    expect(plural("pacote de 1 kg")).toBe("pacotes de 1 kg");
    expect(plural("barril de 30 L")).toBe("barris de 30 L");
    expect(textoCompra("g", 8, 1000, "pacote de 1 kg")).toBe("8 pacotes de 1 kg");
    expect(textoCompra("ml", 1, 30_000, "barril de 30 L")).toBe("1 barril de 30 L");
    expect(textoCompra("g", 7, 1000, "kg")).toBe("7 kg");
    expect(textoCompra("un", 2, 12, null)).toBe("24 unidades");
  });

  it("monta a lista para o WhatsApp por onde se compra, sem preço", () => {
    const linha = (nome: string, onde: string | null, embalagens: number, nomeEmb: string) =>
      ({
        nome,
        onde_compra: onde,
        unidade: "g",
        embalagens,
        embalagem_quantidade: 1000,
        embalagem_nome: nomeEmb,
        valor_centavos: 99_00,
      }) as LinhaDeCompra;
    const lista = {
      compra: "2026-11-06",
      comprar: [
        linha("Carne moída", "Açougue", 12, "kg"),
        linha("Massa de lasanha", "Atacado", 8, "pacote de 1 kg"),
        linha("Sal grosso", null, 1, "pacote de 1 kg"),
      ],
    } as ListaDeCompras;
    expect(textoDaLista(lista, "Cantina do Marcos")).toBe(
      "Compras de sexta (Cantina do Marcos)\n" +
        "\nAçougue\n- Carne moída: 12 kg\n" +
        "\nAtacado\n- Massa de lasanha: 8 pacotes de 1 kg\n" +
        "\nOutros\n- Sal grosso: 1 pacote de 1 kg\n",
    );
  });
});
