import { describe, expect, it } from "vitest";

import {
  comparadoCom,
  mesEscolhido,
  nomeDaPlanilha,
  nomeDoMes,
  planilhaDoMes,
  ultimosMeses,
  variacao,
} from "./relatorio";
import type { RelatorioDoMes } from "./tipos";

describe("relatório do mês", () => {
  it("nomes e lista de meses", () => {
    expect(nomeDoMes("2026-10-01")).toBe("outubro de 2026");
    expect(nomeDoMes("2026-03")).toBe("março de 2026");
    expect(ultimosMeses("2026-02-14", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(mesEscolhido("2026-01", "2026-02-14")).toBe("2026-01");
    expect(mesEscolhido("2027-01", "2026-02-14")).toBe("2026-02"); // futuro
    expect(mesEscolhido(null, "2026-02-14")).toBe("2026-02");
    expect(nomeDaPlanilha("Cantina do Marcos", "2026-10-01")).toBe(
      "giro-cantina-do-marcos-2026-10.csv",
    );
    expect(nomeDaPlanilha("Pão & Cia.", "2026-10-01")).toBe("giro-pao-cia-2026-10.csv");
  });

  it("comparação com o mês anterior", () => {
    expect(variacao(112, 100)).toBe("+12%");
    expect(variacao(92, 100)).toBe("−8%");
    expect(variacao(100, 100)).toBe("igual");
    expect(variacao(100, 0)).toBeNull();
    expect(comparadoCom({ completo: true, comparado_de: "2026-10-01" })).toBe("que outubro");
    expect(comparadoCom({ completo: false, comparado_de: "2026-10-01" })).toBe(
      "que o mesmo período de outubro",
    );
    expect(comparadoCom({ completo: false, comparado_de: null })).toBeNull();
  });

  it("planilha para o Excel em português: ponto e vírgula, vírgula decimal e acentos", () => {
    const r = {
      mesas_atendidas: 3,
      pessoas: 7,
      desistencias: 1,
      vendeu_centavos: 123_450,
      ficou_na_mesa_centavos: 8_500,
      espera_media_seg: 150,
      parada_media_seg: null,
      notas: { media: 4.25 },
      noites: [
        {
          dia: "2026-10-02",
          mesas_atendidas: 3,
          pessoas: 7,
          desistencias: 1,
          vendeu_centavos: 123_450,
          ficou_na_mesa_centavos: 8_500,
          espera_media_seg: 150,
          parada_media_seg: null,
          nota_media: 4.25,
        },
      ],
    } as unknown as RelatorioDoMes;
    const planilha = planilhaDoMes(r);
    expect(planilha.startsWith("﻿Noite;Dia da semana;Mesas atendidas")).toBe(true);
    const linhas = planilha.trimEnd().split("\r\n");
    expect(linhas[1]).toBe("02/10/2026;sexta;3;7;1;1.234,50;85,00;2,5;;4,3");
    expect(linhas[2]).toBe("Total do mês;;3;7;1;1.234,50;85,00;2,5;;4,3");
  });
});
