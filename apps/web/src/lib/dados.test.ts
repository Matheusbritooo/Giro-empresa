import { describe, expect, it } from "vitest";

import { dadoGuardado, guardarDado, limparDados } from "./dados";
import { aplicarMensagem, type EstadoSalao } from "./salao";
import type { Salao } from "./tipos";

describe("dados guardados entre as telas", () => {
  it("a tela reabre com o que buscou da última vez, e sair da conta apaga tudo", () => {
    expect(dadoGuardado("estoque:1")).toBeNull();
    guardarDado("estoque:1", { insumos: [1, 2] });
    guardarDado("estoque:2", { insumos: [9] }); // outro restaurante, outra gaveta
    expect(dadoGuardado("estoque:1")).toEqual({ insumos: [1, 2] });
    expect(dadoGuardado("estoque:2")).toEqual({ insumos: [9] });
    expect(dadoGuardado(null)).toBeNull();
    limparDados();
    expect(dadoGuardado("estoque:1")).toBeNull();
    expect(dadoGuardado("estoque:2")).toBeNull();
  });

  it("o aviso de que o canal reconectou não mexe no salão", () => {
    const estado: EstadoSalao = { salao: { mesas: [] } as unknown as Salao, ajusteRelogioMs: 0 };
    expect(aplicarMensagem(estado, { tipo: "reconectou" })).toBe(estado);
  });
});
