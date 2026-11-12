import { describe, expect, it } from "vitest";

import {
  ENVIO_SOZINHO_MS,
  foiRecusado,
  haQuanto,
  novaChave,
  paraConfirmar,
  paraEnviar,
  type PedidoNaFila,
  recusados,
  textoDaFila,
} from "./fila-pedidos";

const AGORA = Date.parse("2026-11-13T23:30:00Z");

function pedido(chave: string, extra: Partial<PedidoNaFila> = {}): PedidoNaFila {
  return {
    chave,
    usuarioId: 3,
    mesaId: 7,
    mesaNumero: 7,
    itens: [{ item_id: 10, nome: "Lasanha à bolonhesa", quantidade: 2, observacao: null }],
    guardadoEm: AGORA - 60_000,
    ...extra,
  };
}

describe("fila de pedidos sem internet", () => {
  it("sobe sozinho só o que é desta conta, não foi recusado e está guardado há pouco", () => {
    const fila = [
      pedido("novo"),
      pedido("de-outra-conta", { usuarioId: 9 }),
      pedido("recusado", { recusado: "Lasanha à bolonhesa acabou" }),
      pedido("velho", { guardadoEm: AGORA - ENVIO_SOZINHO_MS - 1 }),
      pedido("no-limite", { guardadoEm: AGORA - ENVIO_SOZINHO_MS }),
    ];
    expect(paraEnviar(fila, 3, AGORA).map((p) => p.chave)).toEqual(["novo", "no-limite"]);
    // Guardado há tempo demais: o garçom diz se ainda vale, em vez de chegar sozinho na cozinha.
    expect(paraConfirmar(fila, 3, AGORA).map((p) => p.chave)).toEqual(["velho"]);
    expect(recusados(fila, 3).map((p) => p.chave)).toEqual(["recusado"]);
    expect(paraEnviar(fila, 9, AGORA).map((p) => p.chave)).toEqual(["de-outra-conta"]);
  });

  it("só desiste do pedido quando o servidor diz que ele não entra", () => {
    // Sem resposta, sessão vencida, servidor ocupado ou fora do ar: continua na fila.
    for (const status of [0, 401, 408, 429, 500, 502, 503]) expect(foiRecusado(status)).toBe(false);
    // Acabou um item (409), mesa que não existe (404), pedido inválido (422), sem acesso (403).
    for (const status of [400, 403, 404, 409, 422]) expect(foiRecusado(status)).toBe(true);
  });

  it("textos da faixa", () => {
    expect(textoDaFila(1)).toBe("1 pedido na fila");
    expect(textoDaFila(3)).toBe("3 pedidos na fila");
    expect(haQuanto(AGORA - 25 * 60_000, AGORA)).toBe("há 25 min");
    expect(haQuanto(AGORA - 20_000, AGORA)).toBe("há 1 min");
    expect(haQuanto(AGORA - 125 * 60_000, AGORA)).toBe("há 2 h 5 min");
    expect(haQuanto(AGORA - 120 * 60_000, AGORA)).toBe("há 2 h");
  });

  it("cada lançamento ganha uma chave que o servidor aceita", () => {
    const chaves = new Set(Array.from({ length: 50 }, novaChave));
    expect(chaves.size).toBe(50);
    for (const chave of chaves) expect(chave).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });
});
