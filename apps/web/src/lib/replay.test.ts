import { describe, expect, it } from "vitest";

import {
  calorPorMesa,
  linhaDaMesa,
  linhaDoTempo,
  momentosDaNoite,
  salaoNoInstante,
  travasPorMesa,
} from "./replay";
import {
  comBusca,
  comparar,
  horaLocal,
  lerDia,
  lerPeriodo,
  minutos,
  noiteDe,
  noitePadrao,
  reais,
  rotuloDia,
  somarDias,
} from "./resultados";
import type { Replay } from "./tipos";

// Sexta, 16/10/2026, horário de São Paulo (UTC-3).
const h = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 9, 16, hora + 3, minuto)).toISOString();
const ms = (hora: number, minuto = 0) => Date.parse(h(hora, minuto));

const REPLAY: Replay = {
  dia: "2026-10-16",
  inicio: h(6),
  fim: new Date(Date.UTC(2026, 9, 17, 9)).toISOString(),
  limite_alerta_seg: 300,
  mesas: [
    { id: 11, numero: 1, lugares: 2, pos_x: 0, pos_y: 0 },
    { id: 12, numero: 2, lugares: 4, pos_x: 1, pos_y: 0 },
    { id: 17, numero: 7, lugares: 6, pos_x: 2, pos_y: 0 },
  ],
  visitas: [
    // Mesa 1: atendida em 3 min, sai 20h40, fica suja até 20h55.
    {
      mesa_id: 11,
      sentou_em: h(20),
      atendida_em: h(20, 3),
      saiu_em: h(20, 40),
      liberada_em: h(20, 55),
      pessoas: 2,
      sem_atendimento: false,
    },
    // Mesa 2: espera 12 min (passou do alerta) e é atendida às 20h22.
    {
      mesa_id: 12,
      sentou_em: h(20, 10),
      atendida_em: h(20, 22),
      saiu_em: h(21, 10),
      liberada_em: h(21, 12),
      pessoas: 4,
      sem_atendimento: false,
    },
    // Mesa 2 de novo: ninguém aparece e vão embora às 21h35.
    {
      mesa_id: 12,
      sentou_em: h(21, 20),
      atendida_em: null,
      saiu_em: h(21, 35),
      liberada_em: h(21, 35),
      pessoas: 2,
      sem_atendimento: true,
    },
  ],
};

function mesa(t: number, numero: number) {
  const m = salaoNoInstante(REPLAY, t).mesas.find((x) => x.numero === numero);
  if (!m) throw new Error(`mesa ${numero}`);
  return m;
}

describe("replay da noite", () => {
  it("cada mesa passa pelos estados na hora certa", () => {
    expect(mesa(ms(19, 59), 1).estado).toBe("livre");
    expect(mesa(ms(20, 1), 1)).toMatchObject({
      estado: "aguardando",
      pessoas: 2,
      sentou_em: h(20),
    });
    expect(mesa(ms(20, 10), 1)).toMatchObject({ estado: "ocupada", atendida_em: h(20, 3) });
    expect(mesa(ms(20, 45), 1)).toMatchObject({
      estado: "para_limpar",
      pessoas: 0,
      saiu_em: h(20, 40),
    });
    expect(mesa(ms(21), 1)).toMatchObject({ estado: "livre", estado_desde: h(20, 55) });
  });

  it("quem vai embora sem atendimento deixa a mesa livre direto", () => {
    expect(mesa(ms(21, 30), 2).estado).toBe("aguardando");
    expect(mesa(ms(21, 36), 2)).toMatchObject({ estado: "livre", estado_desde: h(21, 35) });
  });

  it("não mostra o futuro: horário de atendimento só depois que aconteceu", () => {
    expect(mesa(ms(20, 2), 1).atendida_em).toBeNull();
    expect(mesa(ms(20, 2), 1).saiu_em).toBeNull();
  });

  it("alerta aparece depois do limite e o garçom vai um minuto antes de chegar", () => {
    expect(salaoNoInstante(REPLAY, ms(20, 14)).alertas).toEqual([]);
    const [alerta] = salaoNoInstante(REPLAY, ms(20, 16)).alertas;
    expect(alerta).toMatchObject({ mesa_numero: 2, criado_em: h(20, 15), reconhecido_em: null });
    const indo = salaoNoInstante(REPLAY, ms(20, 21)).alertas[0];
    expect(indo.reconhecido_em).toBe(h(20, 21));
    expect(salaoNoInstante(REPLAY, ms(20, 23)).alertas).toEqual([]); // atendida
  });

  it("linha do tempo vai do primeiro cliente à última mesa liberada, com folga", () => {
    expect(linhaDoTempo(REPLAY)).toEqual({ inicioMs: ms(19, 50), fimMs: ms(21, 45) });
    expect(linhaDoTempo({ ...REPLAY, visitas: [] })).toBeNull();
  });

  it("mapa de calor: a pior mesa vale 1", () => {
    const calor = calorPorMesa(REPLAY);
    // Mesa 1: 15 min suja. Mesa 2: 2 min suja + uma desistência (15) = 17.
    expect(calor.get(12)).toBe(1);
    expect(calor.get(11)).toBeCloseTo(15 / 17);
    expect(calor.has(17)).toBe(false); // mesa 7 não teve ninguém
  });

  it("onde o salão travou, da pior mesa para a melhor", () => {
    expect(
      travasPorMesa(REPLAY).map((t) => [t.numero, Math.round(t.minutosSuja), t.foramEmbora]),
    ).toEqual([
      [2, 2, 1],
      [1, 15, 0],
    ]);
  });

  it("conta a noite de uma mesa em frases curtas", () => {
    expect(linhaDaMesa(REPLAY, 12)).toEqual([
      "20:10: 4 pessoas, atendidas em 12 min, saíram às 21:10, mesa liberada 2 min depois.",
      "21:20: 2 pessoas sentaram e foram embora sem atendimento às 21:35.",
    ]);
    expect(linhaDaMesa(REPLAY, 17)).toEqual([]);
  });

  it("momentos da noite, em ordem de horário", () => {
    expect(momentosDaNoite(REPLAY).map((m) => m.texto)).toEqual([
      "Mesa 2: esperou 12 min pelo atendimento",
      "Mesa 1: ficou 15 min suja",
      "Mesa 2: foram embora sem atendimento",
    ]);
  });
});

describe("textos dos resultados", () => {
  it("noite vai das 6h às 6h no horário de São Paulo", () => {
    expect(noiteDe(ms(23))).toBe("2026-10-16");
    expect(noiteDe(Date.UTC(2026, 9, 17, 4, 30))).toBe("2026-10-16"); // 1h30 de sábado
    expect(noiteDe(Date.UTC(2026, 9, 17, 9, 30))).toBe("2026-10-17");
  });

  it("antes de abrir, mostra a noite de ontem", () => {
    expect(noitePadrao(ms(15), "18:00")).toBe("2026-10-15");
    expect(noitePadrao(ms(19), "18:00")).toBe("2026-10-16");
    expect(noitePadrao(Date.UTC(2026, 9, 17, 4), "18:00")).toBe("2026-10-16"); // 1h da manhã
  });

  it("formata para o dono ler", () => {
    expect(rotuloDia("2026-10-16")).toBe("sexta, 16/10");
    expect(somarDias("2026-10-16", -7)).toBe("2026-10-09");
    expect(horaLocal(h(20, 31))).toBe("20:31");
    expect(reais(121_300)).toBe("R$ 1.213");
    expect(reais(-8500)).toBe("-R$ 85");
    expect(minutos(390)).toBe("6,5 min");
    expect(minutos(1200)).toBe("20 min");
    expect(minutos(3900)).toBe("1h05");
    expect(minutos(null)).toBe("–");
  });

  it("compara com o período anterior dizendo se melhorou", () => {
    expect(comparar(80, 100, true, "a sexta passada")).toEqual({
      texto: "20% a menos que a sexta passada",
      tom: "melhor",
    });
    expect(comparar(30, 25, false, "a sexta passada")).toEqual({
      texto: "20% a mais que a sexta passada",
      tom: "melhor",
    });
    expect(comparar(5, 0, true, "a sexta passada")?.tom).toBe("pior");
    expect(comparar(null, 3, true, "x")).toBeNull();
  });

  it("lê período e dia da URL sem confiar nela", () => {
    expect(lerPeriodo("semana")).toBe("semana");
    expect(lerPeriodo("ano")).toBe("noite");
    expect(lerDia("2026-10-16")).toBe("2026-10-16");
    expect(lerDia("2026-02-31")).toBeNull();
    expect(lerDia("ontem")).toBeNull();
    const atual = new URLSearchParams("restaurante=2&dia=2026-10-16");
    expect(comBusca("/resultados/replay", atual, { periodo: null, dia: "2026-10-09" })).toBe(
      "/resultados/replay?restaurante=2&dia=2026-10-09",
    );
  });
});
