import { describe, expect, it } from "vitest";

import { diaLocal, lerGrupo, lerPeriodoHistorico, porDia } from "./historico";
import type { Atividade } from "./tipos";

const atividade = (id: number, em: string, quem: string | null = "Marcos"): Atividade => ({
  id,
  em,
  grupo: "cardapio",
  texto: `linha ${id}`,
  quem,
  usuario_id: quem ? 1 : null,
});

describe("histórico de quem fez o quê", () => {
  it("separa por dia do calendário de São Paulo, com Hoje e Ontem", () => {
    // 01:30 em São Paulo do dia 24 ainda é dia 24 no calendário (não é a noite de 23).
    expect(diaLocal("2026-11-24T04:30:00Z")).toBe("2026-11-24");
    expect(diaLocal("2026-11-24T02:30:00Z")).toBe("2026-11-23");
    const dias = porDia(
      [
        atividade(4, "2026-11-24T22:10:00Z"),
        atividade(3, "2026-11-24T12:00:00Z", null),
        atividade(2, "2026-11-23T23:00:00Z"),
        atividade(1, "2026-11-21T20:05:00Z"),
      ],
      "2026-11-24",
    );
    expect(dias.map((d) => [d.rotulo, d.linhas.length])).toEqual([
      ["Hoje", 2],
      ["Ontem", 1],
      ["sábado, 21/11", 1],
    ]);
    expect(dias[0].linhas[0]).toEqual({ id: 4, hora: "19:10", texto: "linha 4", quem: "Marcos" });
    expect(dias[0].linhas[1].quem).toBe("GIRO");
  });

  it("lê os filtros da URL com valor padrão", () => {
    expect(lerPeriodoHistorico("mes")).toBe("mes");
    expect(lerPeriodoHistorico("ano")).toBe("semana");
    expect(lerGrupo("estoque")).toBe("estoque");
    expect(lerGrupo("x")).toBeNull();
  });
});
