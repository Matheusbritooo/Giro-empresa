import { describe, expect, it } from "vitest";

import {
  aplicarMensagem,
  camerasSemSinal,
  contarPorTom,
  SALAO_VAZIO,
  situacao,
  tempoDecorrido,
} from "./salao";
import type { Alerta, Camera, Mesa, Salao } from "./tipos";

const AGORA = Date.parse("2026-10-23T23:41:00Z");
const minutosAtras = (m: number) => new Date(AGORA - m * 60_000).toISOString();

function mesa(dados: Partial<Mesa>): Mesa {
  return {
    id: 1,
    numero: 7,
    lugares: 4,
    pos_x: 0,
    pos_y: 0,
    ativa: true,
    estado: "livre",
    estado_desde: null,
    camera_id: null,
    poligono: null,
    sentou_em: null,
    atendida_em: null,
    saiu_em: null,
    pessoas: 0,
    ...dados,
  };
}

function alerta(dados: Partial<Alerta>): Alerta {
  return {
    id: 1,
    tipo: "sem_atendimento",
    mesa_id: 1,
    mesa_numero: 7,
    criado_em: minutosAtras(1),
    reconhecido_em: null,
    resolvido_em: null,
    ...dados,
  };
}

function camera(dados: Partial<Camera>): Camera {
  return {
    id: 1,
    nome: "Salão",
    ativa: true,
    ultima_observacao_em: minutosAtras(0),
    ajustes_visao: null,
    ...dados,
  };
}

const salao: Salao = {
  restaurante: {
    id: 1,
    nome: "Cantina",
    cidade: null,
    alerta_atendimento_seg: 300,
    ticket_medio_centavos: 8500,
    abre_as: "18:00",
    fecha_as: "23:30",
  },
  mesas: [mesa({ id: 1, numero: 1 }), mesa({ id: 2, numero: 2 })],
  alertas: [],
  cameras: [camera({ ultima_observacao_em: minutosAtras(10) })],
  agora: new Date(AGORA).toISOString(),
};

describe("tempoDecorrido", () => {
  it("mostra minutos e segundos até uma hora", () => {
    expect(tempoDecorrido(minutosAtras(4.5), AGORA)).toBe("4:30");
    expect(tempoDecorrido(minutosAtras(0), AGORA)).toBe("0:00");
  });
  it("mostra horas depois de uma hora", () => {
    expect(tempoDecorrido(minutosAtras(65), AGORA)).toBe("1h05");
  });
  it("não fica negativo se o relógio do aparelho estiver adiantado", () => {
    expect(tempoDecorrido(new Date(AGORA + 5000).toISOString(), AGORA)).toBe("0:00");
  });
});

describe("situacao da mesa", () => {
  it("esperando vira atrasada quando passa do limite do restaurante", () => {
    const esperando = mesa({ estado: "aguardando", sentou_em: minutosAtras(4), pessoas: 2 });
    expect(situacao(esperando, AGORA, 300).tom).toBe("aguardando");
    const atrasada = mesa({ estado: "aguardando", sentou_em: minutosAtras(6), pessoas: 2 });
    expect(situacao(atrasada, AGORA, 300)).toMatchObject({ tom: "atrasada", curto: "Atrasada" });
    expect(situacao(atrasada, AGORA, 600).tom).toBe("aguardando");
  });

  it("mesa ocupada conta o tempo desde que sentaram", () => {
    const ocupada = mesa({
      estado: "ocupada",
      sentou_em: minutosAtras(40),
      atendida_em: minutosAtras(37),
      estado_desde: minutosAtras(37),
    });
    expect(situacao(ocupada, AGORA, 300).desde).toBe(minutosAtras(40));
  });

  it("mesa para limpar conta o tempo desde que saíram", () => {
    const suja = mesa({ estado: "para_limpar", saiu_em: minutosAtras(21) });
    expect(situacao(suja, AGORA, 300)).toMatchObject({ tom: "limpar", desde: minutosAtras(21) });
  });

  it("livre não tem cronômetro", () => {
    expect(situacao(mesa({}), AGORA, 300).desde).toBeNull();
  });

  it("conta quantas mesas há em cada estado", () => {
    const mesas = [
      mesa({ id: 1 }),
      mesa({ id: 2, estado: "aguardando", sentou_em: minutosAtras(8) }),
      mesa({ id: 3, estado: "ocupada", sentou_em: minutosAtras(8) }),
    ];
    expect(contarPorTom(mesas, AGORA, 300)).toEqual({
      livre: 1,
      aguardando: 0,
      atrasada: 1,
      ocupada: 1,
      limpar: 0,
    });
  });
});

describe("mensagens ao vivo", () => {
  const inicial = aplicarMensagem(SALAO_VAZIO, { tipo: "salao", salao }, AGORA - 2000);

  it("o salão completo calcula a diferença de relógio com o servidor", () => {
    expect(inicial.ajusteRelogioMs).toBe(2000);
    expect(inicial.salao?.mesas).toHaveLength(2);
  });

  it("mudança de mesa substitui só aquela mesa", () => {
    const novo = aplicarMensagem(inicial, {
      tipo: "mesa",
      mesa: mesa({ id: 2, numero: 2, estado: "ocupada" }),
    });
    expect(novo.salao?.mesas.map((m) => m.estado)).toEqual(["livre", "ocupada"]);
  });

  it("mesa desativada sai do mapa", () => {
    const novo = aplicarMensagem(inicial, {
      tipo: "mesa",
      mesa: mesa({ id: 2, numero: 2, ativa: false }),
    });
    expect(novo.salao?.mesas.map((m) => m.id)).toEqual([1]);
  });

  it("alerta novo entra, alerta resolvido sai", () => {
    const comAlerta = aplicarMensagem(inicial, { tipo: "alerta", alerta: alerta({ id: 9 }) });
    expect(comAlerta.salao?.alertas.map((a) => a.id)).toEqual([9]);
    const resolvido = aplicarMensagem(comAlerta, {
      tipo: "alerta",
      alerta: alerta({ id: 9, resolvido_em: minutosAtras(0) }),
    });
    expect(resolvido.salao?.alertas).toEqual([]);
  });

  it("alerta reconhecido atualiza no lugar, sem duplicar", () => {
    const comAlerta = aplicarMensagem(inicial, { tipo: "alerta", alerta: alerta({ id: 9 }) });
    const reconhecido = aplicarMensagem(comAlerta, {
      tipo: "alerta",
      alerta: alerta({ id: 9, reconhecido_em: minutosAtras(0) }),
    });
    expect(reconhecido.salao?.alertas).toHaveLength(1);
    expect(reconhecido.salao?.alertas[0].reconhecido_em).not.toBeNull();
  });

  it("mensagem antes do salão carregar é ignorada", () => {
    expect(aplicarMensagem(SALAO_VAZIO, { tipo: "mesa", mesa: mesa({}) })).toBe(SALAO_VAZIO);
  });
});

describe("câmeras", () => {
  it("câmera que parou de mandar foto há mais de 90 s aparece como sem sinal", () => {
    const cameras = [
      camera({ id: 1, ultima_observacao_em: minutosAtras(0.5) }),
      camera({ id: 2, ultima_observacao_em: minutosAtras(3) }),
      camera({ id: 3, ultima_observacao_em: null }), // nunca conectou: aviso fica em Câmeras
      camera({ id: 4, ultima_observacao_em: minutosAtras(30), ativa: false }),
    ];
    expect(camerasSemSinal(cameras, AGORA).map((c) => c.id)).toEqual([2]);
  });

  it("foto nova da câmera atualiza o status ao vivo", () => {
    const inicial = aplicarMensagem(SALAO_VAZIO, { tipo: "salao", salao }, AGORA);
    expect(camerasSemSinal(inicial.salao?.cameras ?? [], AGORA)).toHaveLength(1);
    const viva = aplicarMensagem(inicial, {
      tipo: "camera",
      camera: camera({ ultima_observacao_em: minutosAtras(0) }),
    });
    expect(camerasSemSinal(viva.salao?.cameras ?? [], AGORA)).toHaveLength(0);
  });
});
