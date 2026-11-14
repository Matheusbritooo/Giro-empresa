import { describe, expect, it } from "vitest";

import {
  comRestaurante,
  irPara,
  juntarPendencias,
  pendenciasAoVivo,
  resumoDoSalao,
  textoDoCostume,
} from "./hoje";
import type { Mesa, Pendencia, Salao } from "./tipos";

const AGORA = Date.parse("2026-11-13T23:30:00Z");
const ha = (minutos: number) => new Date(AGORA - minutos * 60_000).toISOString();

function mesa(numero: number, estado: Mesa["estado"], sentouHaMin: number | null = null): Mesa {
  return {
    id: numero,
    numero,
    estado,
    ativa: true,
    sentou_em: sentouHaMin === null ? null : ha(sentouHaMin),
    estado_desde: sentouHaMin === null ? null : ha(sentouHaMin),
  } as Mesa;
}

const SALAO = {
  restaurante: { alerta_atendimento_seg: 300 },
  mesas: [
    mesa(1, "ocupada", 40),
    mesa(2, "ocupada", 12),
    mesa(3, "aguardando", 2), // dentro do tempo
    mesa(4, "aguardando", 7), // passou dos 5 min
    mesa(5, "para_limpar", 3),
    mesa(6, "livre"),
  ],
  alertas: [
    { id: 1, tipo: "mesa_vaga", mesa_id: 5, mesa_numero: 5, criado_em: ha(3) },
    { id: 2, tipo: "sem_atendimento", mesa_id: 4, mesa_numero: 4, criado_em: ha(2) },
  ],
  cameras: [
    { id: 1, nome: "Salão", ativa: true, ultima_observacao_em: ha(0.1) },
    { id: 2, nome: "Varanda", ativa: true, ultima_observacao_em: ha(4) },
  ],
} as unknown as Salao;

describe("tela Hoje", () => {
  it("o salão agora, em números", () => {
    expect(resumoDoSalao(SALAO, AGORA)).toEqual({
      mesas: 6,
      ocupadas: 2,
      esperando: 2,
      semAtendimento: 1,
      paraLimpar: 1,
    });
  });

  it("alerta aberto e câmera sem sinal viram pendência", () => {
    expect(pendenciasAoVivo(SALAO, AGORA)).toEqual([
      {
        tipo: "alerta",
        texto: "Mesa 5 vagou e precisa ser limpa, há 3:00.",
        href: "/salao",
        urgente: false,
      },
      {
        tipo: "alerta",
        texto: "Mesa 4 está sem atendimento, há 2:00.",
        href: "/salao",
        urgente: true,
      },
      {
        tipo: "camera",
        texto: "A câmera Varanda está sem sinal. Sem ela, o salão para de se atualizar.",
        href: "/cameras",
        urgente: true,
      },
    ]);
  });

  it("o urgente vem primeiro, e o salão antes do resto", () => {
    const p = (tipo: string, urgente: boolean): Pendencia => ({
      tipo,
      texto: tipo,
      href: "/",
      urgente,
    });
    const lista = juntarPendencias(
      [p("mesa-vaga", false), p("sem-atendimento", true)],
      [p("cozinha", true), p("contar", false)],
    );
    expect(lista.map((x) => x.tipo)).toEqual(["sem-atendimento", "cozinha", "mesa-vaga", "contar"]);
  });

  it("links e textos", () => {
    expect(irPara("cozinha")).toBe("Abrir a cozinha");
    expect(irPara("vai_faltar")).toBe("Abrir o estoque");
    expect(irPara("perdas")).toBe("Ver as perdas");
    expect(comRestaurante("/estoque?aba=perdas", null)).toBe("/estoque?aba=perdas");
    expect(comRestaurante("/estoque?aba=perdas", "2")).toBe("/estoque?aba=perdas&restaurante=2");
    expect(comRestaurante("/cozinha", "2")).toBe("/cozinha?restaurante=2");
    expect(textoDoCostume({ noites: 4, mesas_atendidas: 27 })).toBe("costuma fechar com 27");
    expect(textoDoCostume(null)).toBe("ainda sem noites para comparar");
  });
});
