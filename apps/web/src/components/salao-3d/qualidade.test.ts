import { describe, expect, it } from "vitest";

import {
  ajustesDoNivel,
  escolherNivel,
  type InfoAparelho,
  lerNivel,
  nivelAbaixo,
  nivelForcado,
} from "./qualidade";

const computadorBom: InfoAparelho = {
  placa: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  nucleos: 12,
  memoriaGb: 8,
  toque: false,
};

describe("escolherNivel", () => {
  it("computador com placa de vídeo de verdade fica no alto", () => {
    expect(escolherNivel(computadorBom)).toBe("alto");
    expect(escolherNivel({ ...computadorBom, placa: "Apple M2" })).toBe("alto");
  });

  it("desenho por software fica no baixo, seja qual for o resto", () => {
    for (const placa of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "Microsoft Basic Render Driver",
    ]) {
      expect(escolherNivel({ ...computadorBom, placa })).toBe("baixo");
    }
    expect(escolherNivel({ ...computadorBom, semAceleracao: true })).toBe("baixo");
  });

  it("placa integrada ou máquina modesta fica no médio", () => {
    expect(
      escolherNivel({ ...computadorBom, placa: "ANGLE (Intel, Intel(R) UHD Graphics 620)" }),
    ).toBe("medio");
    expect(escolherNivel({ ...computadorBom, nucleos: 4 })).toBe("medio");
    expect(escolherNivel({ ...computadorBom, memoriaGb: 4 })).toBe("medio");
  });

  it("máquina muito fraca fica no baixo", () => {
    expect(escolherNivel({ ...computadorBom, nucleos: 2 })).toBe("baixo");
    expect(escolherNivel({ ...computadorBom, memoriaGb: 2 })).toBe("baixo");
  });

  it("celular bom fica no médio e celular fraco no baixo", () => {
    const celular: InfoAparelho = {
      placa: "Adreno (TM) 740",
      nucleos: 8,
      memoriaGb: 8,
      toque: true,
    };
    expect(escolherNivel(celular)).toBe("medio");
    expect(escolherNivel({ ...celular, placa: "Mali-G52 MC2" })).toBe("baixo");
    expect(escolherNivel({ ...celular, placa: "Adreno (TM) 506" })).toBe("baixo");
    expect(escolherNivel({ ...celular, nucleos: 4 })).toBe("baixo");
    expect(escolherNivel({ ...celular, memoriaGb: 3 })).toBe("baixo");
  });

  it("sem saber nada do aparelho, não arrisca o alto", () => {
    expect(escolherNivel({ placa: "" })).toBe("medio");
  });

  it("a URL e o guardado mandam, com a URL na frente", () => {
    const software = { placa: "SwiftShader", forcadoGuardado: "alto" };
    expect(escolherNivel(software)).toBe("alto");
    expect(escolherNivel({ ...software, forcadoNaUrl: "medio" })).toBe("medio");
    expect(escolherNivel({ ...computadorBom, forcadoNaUrl: "baixo" })).toBe("baixo");
    // Valor que não existe é ignorado.
    expect(escolherNivel({ ...computadorBom, forcadoNaUrl: "ultra" })).toBe("alto");
    expect(nivelForcado(computadorBom)).toBeNull();
  });
});

describe("níveis", () => {
  it("lê o nível escrito à mão", () => {
    expect(lerNivel("ALTO")).toBe("alto");
    expect(lerNivel("médio")).toBe("medio");
    expect(lerNivel(" baixo ")).toBe("baixo");
    expect(lerNivel("")).toBeNull();
    expect(lerNivel(null)).toBeNull();
  });

  it("desce um nível de cada vez e para no baixo", () => {
    expect(nivelAbaixo("alto")).toBe("medio");
    expect(nivelAbaixo("medio")).toBe("baixo");
    expect(nivelAbaixo("baixo")).toBe("baixo");
  });

  it("cada nível liga só o que aguenta", () => {
    const alto = ajustesDoNivel("alto");
    const medio = ajustesDoNivel("medio");
    const baixo = ajustesDoNivel("baixo");
    expect(alto).toMatchObject({
      efeitos: true,
      oclusao: true,
      sombras: "dinamicas",
      animar: true,
    });
    expect(alto.texturas).toBe(512);
    expect(medio).toMatchObject({ efeitos: true, oclusao: false, sombras: "estaticas" });
    expect(medio.texturas).toBe(256);
    expect(baixo).toMatchObject({ efeitos: false, oclusao: false, sombras: "nenhuma" });
    expect(baixo).toMatchObject({ animar: false, dpr: 1, texturas: 256 });
  });
});
