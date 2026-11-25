import { describe, expect, it } from "vitest";

import { parteVista, resumoDaConferencia, textoDaDiferenca, textoDoArquivo } from "./caixa";
import type { ConferenciaCaixa } from "./tipos";

describe("conferência com o caixa", () => {
  it("lê o arquivo em UTF-8 e no formato antigo do Windows", () => {
    const utf8 = new TextEncoder().encode("Produto;Total\nMuçarela;10,00").buffer as ArrayBuffer;
    expect(textoDoArquivo(utf8)).toContain("Muçarela");
    // "Muçarela" em windows-1252: o ç é o byte 0xE7 (inválido sozinho em UTF-8).
    const antigo = new Uint8Array([0x4d, 0x75, 0xe7, 0x61, 0x72, 0x65, 0x6c, 0x61]).buffer;
    expect(textoDoArquivo(antigo)).toBe("Muçarela");
  });

  it("diferença e parte vista", () => {
    expect(textoDaDiferenca(21_500, 12_400)).toBe("R$ 91 sem pedido no GIRO");
    expect(textoDaDiferenca(10_000, 12_500)).toBe("R$ 25 a mais no GIRO");
    expect(textoDaDiferenca(10_000, 10_050)).toBe("bateu");
    expect(parteVista({ caixa_centavos: 20_000, giro_centavos: 17_400 })).toBe("87%");
    expect(parteVista({ caixa_centavos: 0, giro_centavos: 0 })).toBeNull();
  });

  it("resumo em uma frase", () => {
    const c = {
      noites: [{ noite: "2026-11-21", caixa_centavos: 21_500, giro_centavos: 12_400 }],
      caixa_centavos: 21_500,
      giro_centavos: 12_400,
    } as ConferenciaCaixa;
    expect(resumoDaConferencia(c)).toMatch(/^Na noite do caixa, R\$ 91 foram vendidos sem pedido/);
    expect(resumoDaConferencia({ ...c, giro_centavos: 21_500 })).toBe(
      "Na noite do caixa, tudo o que foi vendido passou pelo GIRO.",
    );
  });
});
