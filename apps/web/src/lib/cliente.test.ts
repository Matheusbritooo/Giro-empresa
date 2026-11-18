import { describe, expect, it } from "vitest";

import { enderecoDoQr, sugestoesDaCasa, textoDoBotao } from "./cliente";
import type { MesaPublica } from "./tipos";

describe("página do QR da mesa", () => {
  it("o QR leva para a página da mesa no endereço do painel", () => {
    expect(enderecoDoQr("https://giro.exemplo", "abc123")).toBe("https://giro.exemplo/m/abc123");
    expect(enderecoDoQr("https://giro.exemplo/", "abc123")).toBe("https://giro.exemplo/m/abc123");
  });

  it("sugestão da casa só com o que ainda tem hoje", () => {
    const item = (nome: string, sugestao: boolean, disponivel = true) => ({
      nome,
      descricao: null,
      preco_centavos: 5900,
      disponivel,
      sugestao,
    });
    const mesa = {
      categorias: [
        { nome: "Massas", bebida: false, itens: [item("Lasanha", true), item("Nhoque", false)] },
        { nome: "Pratos", bebida: false, itens: [item("Polpettone", true, false)] },
      ],
    } as MesaPublica;
    expect(sugestoesDaCasa(mesa)).toEqual(["Lasanha"]);
  });

  it("o botão diz quando a equipe já foi chamada", () => {
    expect(textoDoBotao("garcom", [])).toBe("Chamar o garçom");
    expect(textoDoBotao("garcom", ["garcom"])).toBe("Garçom a caminho");
    expect(textoDoBotao("conta", ["garcom"])).toBe("Pedir a conta");
    expect(textoDoBotao("conta", ["conta"])).toBe("Conta a caminho");
  });
});
