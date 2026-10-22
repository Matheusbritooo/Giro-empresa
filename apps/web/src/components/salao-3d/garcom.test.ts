import { describe, expect, it } from "vitest";

import type { Alerta, EstadoMesa, Mesa } from "@/lib/tipos";

import {
  comprimento,
  estacaoDoGarcom,
  FOLGA_ROTA,
  type Ponto,
  planejarGarcom,
  pontoDeAtendimento,
  pontoNaRota,
  rotaAte,
} from "./garcom";
import { montarPlanta, type PlantaSalao } from "./planta";

function mesa(
  numero: number,
  lugares: number,
  pos_x: number,
  pos_y: number,
  extra: Partial<Mesa> = {},
): Mesa {
  return {
    id: numero,
    numero,
    lugares,
    pos_x,
    pos_y,
    ativa: true,
    estado: "livre",
    estado_desde: null,
    camera_id: null,
    poligono: null,
    sentou_em: null,
    atendida_em: null,
    saiu_em: null,
    pessoas: 0,
    ...extra,
  };
}

// A Cantina do Marcos, igual à de planta.test.ts: 14 mesas numa grade de 4 colunas.
const CANTINA = [
  mesa(1, 2, 0, 0),
  mesa(2, 2, 1, 0),
  mesa(3, 4, 2, 0),
  mesa(4, 4, 3, 0),
  mesa(5, 4, 0, 1),
  mesa(6, 4, 1, 1),
  mesa(7, 6, 2, 1),
  mesa(8, 4, 3, 1),
  mesa(9, 4, 0, 2),
  mesa(10, 4, 1, 2),
  mesa(11, 2, 2, 2),
  mesa(12, 2, 3, 2),
  mesa(13, 8, 0, 3),
  mesa(14, 6, 2, 3),
];

/** Gerador de números com semente, para os salões sorteados serem sempre os mesmos. */
function sorteador(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Salão sorteado: até 6x5 casas, de 6 a 20 mesas, com mesas de 2 a 10 lugares. */
function salaoSorteado(semente: number): Mesa[] {
  const acaso = sorteador(semente);
  const colunas = 2 + Math.floor(acaso() * 5);
  const linhas = 2 + Math.floor(acaso() * 4);
  const casas = Array.from({ length: colunas * linhas }, (_, i) => i);
  for (let i = casas.length - 1; i > 0; i--) {
    const j = Math.floor(acaso() * (i + 1));
    [casas[i], casas[j]] = [casas[j], casas[i]];
  }
  const quantas = Math.min(casas.length, 6 + Math.floor(acaso() * 15));
  const tamanhos = [2, 4, 6, 8, 10];
  const mesas = casas.slice(0, quantas).map((casa, i) => {
    const lugares = tamanhos[Math.floor(acaso() * tamanhos.length)];
    return mesa(i + 1, lugares, casa % colunas, Math.floor(casa / colunas));
  });
  // Toda planta sorteada tem pelo menos uma mesa de 8 e uma de 10 lugares.
  mesas[0] = { ...mesas[0], lugares: 8 };
  mesas[1] = { ...mesas[1], lugares: 10 };
  return mesas;
}

const SEMENTES = [1, 7, 42, 2024, 31337, 99991];

const LAYOUTS: [string, Mesa[]][] = [
  ["cantina", CANTINA],
  ...SEMENTES.map((s): [string, Mesa[]] => [`sorteado ${s}`, salaoSorteado(s)]),
];

/** Ponto dentro da pegada de alguma mesa (com a folga da rota)? Devolve o número dela. */
function mesaNoCaminho(planta: PlantaSalao, p: Ponto): number | null {
  for (const m of planta.mesas) {
    const folgaX = m.meiaPegada.x + FOLGA_ROTA - 1e-6;
    const folgaZ = m.meiaPegada.z + FOLGA_ROTA - 1e-6;
    if (Math.abs(p.x - m.x) < folgaX && Math.abs(p.z - m.z) < folgaZ) return m.mesa.numero;
  }
  return null;
}

/** Confere tudo o que uma rota precisa ter, andando por ela de 5 em 5 cm. */
function conferirRota(planta: PlantaSalao, rota: Ponto[], de: Ponto, para: Ponto) {
  expect(rota[0]).toEqual({ x: de.x, z: de.z });
  expect(rota[rota.length - 1]).toEqual({ x: para.x, z: para.z });
  for (let i = 1; i < rota.length; i++) {
    const a = rota[i - 1];
    const b = rota[i];
    expect(Math.hypot(b.x - a.x, b.z - a.z), "ponto repetido").toBeGreaterThan(1e-6);
    const soX = Math.abs(a.z - b.z) < 1e-9;
    const soZ = Math.abs(a.x - b.x) < 1e-9;
    expect(soX || soZ, "trecho na diagonal").toBe(true);
    if (i >= 2) {
      const c = rota[i - 2];
      const cruz = (a.x - c.x) * (b.z - a.z) - (a.z - c.z) * (b.x - a.x);
      expect(Math.abs(cruz), "três pontos na mesma reta").toBeGreaterThan(1e-9);
    }
  }
  const total = comprimento(rota);
  for (let d = 0; d <= total; d += 0.05) {
    const p = pontoNaRota(rota, d);
    expect(mesaNoCaminho(planta, p), `a ${d.toFixed(2)} m`).toBeNull();
    expect(Math.abs(p.x)).toBeLessThan(planta.largura / 2);
    expect(Math.abs(p.z)).toBeLessThan(planta.profundidade / 2);
  }
}

describe("estação do garçom", () => {
  for (const [nome, mesas] of [...LAYOUTS, ["vazio", []] as [string, Mesa[]]]) {
    it(`${nome}: fica no fundo à esquerda, dentro do piso e fora das mesas`, () => {
      const planta = montarPlanta(mesas);
      const e = estacaoDoGarcom(planta);
      expect(e.x).toBeLessThan(-planta.largura / 2 + 2.4);
      expect(e.x).toBeGreaterThan(-planta.largura / 2);
      expect(e.z).toBeLessThan(-planta.profundidade / 2 + 2.4);
      expect(e.z).toBeGreaterThan(-planta.profundidade / 2);
      expect(mesaNoCaminho(planta, e)).toBeNull();
    });
  }
});

describe("ponto de atendimento", () => {
  it("fica fora das cadeiras, a 0,3 m da pegada, olhando a mesa", () => {
    for (const [, mesas] of LAYOUTS) {
      const planta = montarPlanta(mesas);
      for (const item of planta.mesas) {
        for (const lado of ["direita", "esquerda", "frente", "fundo"] as const) {
          const p = pontoDeAtendimento(item, lado);
          expect(mesaNoCaminho(planta, p)).toBeNull();
          const foraX = Math.abs(p.x - item.x) - item.meiaPegada.x;
          const foraZ = Math.abs(p.z - item.z) - item.meiaPegada.z;
          expect(Math.max(foraX, foraZ)).toBeCloseTo(0.3);
          // Andar meio metro para onde ele olha leva para mais perto do centro da mesa.
          const frente = {
            x: p.x + Math.sin(p.rotacao) * 0.5,
            z: p.z + Math.cos(p.rotacao) * 0.5,
          };
          expect(Math.hypot(frente.x - item.x, frente.z - item.z)).toBeCloseTo(
            Math.hypot(p.x - item.x, p.z - item.z) - 0.5,
          );
        }
      }
    }
  });

  it("por padrão fica do lado direito da mesa", () => {
    const [item] = montarPlanta(CANTINA).mesas;
    const p = pontoDeAtendimento(item);
    expect(p.x).toBeGreaterThan(item.x);
    expect(p.z).toBeCloseTo(item.z);
    expect(p.rotacao).toBeCloseTo(-Math.PI / 2);
  });
});

describe("rota do garçom", () => {
  for (const [nome, mesas] of LAYOUTS) {
    it(`${nome}: do balcão até cada mesa e de volta, sem cruzar mesa`, () => {
      const planta = montarPlanta(mesas);
      const estacao = estacaoDoGarcom(planta);
      for (const item of planta.mesas) {
        const alvo = pontoDeAtendimento(item);
        conferirRota(planta, rotaAte(planta, estacao, alvo), estacao, alvo);
        conferirRota(planta, rotaAte(planta, alvo, estacao), alvo, estacao);
      }
    });

    it(`${nome}: de uma mesa para outra, por qualquer lado, sem cruzar mesa`, () => {
      const planta = montarPlanta(mesas);
      const lados = ["direita", "esquerda", "frente", "fundo"] as const;
      const itens = planta.mesas;
      for (let i = 0; i < itens.length; i++) {
        const de = pontoDeAtendimento(itens[i], lados[i % 4]);
        const para = pontoDeAtendimento(itens[(i * 5 + 3) % itens.length], lados[(i + 1) % 4]);
        conferirRota(planta, rotaAte(planta, de, para), de, para);
      }
    });
  }

  it("vai em linha reta quando nada está no caminho", () => {
    const planta = montarPlanta(CANTINA);
    const [a, b] = planta.corredoresX;
    const z = planta.corredoresZ[1];
    expect(rotaAte(planta, { x: a, z }, { x: b, z })).toEqual([
      { x: a, z },
      { x: b, z },
    ]);
  });

  it("na Cantina, sai do balcão e anda pelos corredores até a mesa", () => {
    const planta = montarPlanta(CANTINA);
    const estacao = estacaoDoGarcom(planta);
    const naFaixa = (faixas: number[], v: number) => faixas.some((f) => Math.abs(f - v) < 1e-7);
    for (const item of planta.mesas) {
      const rota = rotaAte(planta, estacao, pontoDeAtendimento(item));
      // Fora a saída e a chegada, todo trecho fica numa faixa de corredor.
      for (let i = 2; i < rota.length - 1; i++) {
        const [a, b] = [rota[i - 1], rota[i]];
        const noCorredor =
          Math.abs(a.z - b.z) < 1e-9
            ? naFaixa(planta.corredoresZ, a.z)
            : naFaixa(planta.corredoresX, a.x);
        expect(noCorredor, `mesa ${item.mesa.numero}, trecho ${i}`).toBe(true);
      }
    }
  });

  it("rota até o mesmo ponto é só o ponto", () => {
    const planta = montarPlanta(CANTINA);
    expect(rotaAte(planta, { x: 1, z: 1 }, { x: 1, z: 1 })).toEqual([{ x: 1, z: 1 }]);
  });
});

describe("andar pela rota", () => {
  const rota: Ponto[] = [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 2, z: 3 },
  ];

  it("comprimento soma os trechos", () => {
    expect(comprimento(rota)).toBeCloseTo(5);
    expect(comprimento([{ x: 1, z: 1 }])).toBe(0);
  });

  it("toda rota até uma mesa tem comprimento", () => {
    const planta = montarPlanta(CANTINA);
    const estacao = estacaoDoGarcom(planta);
    for (const item of planta.mesas) {
      expect(comprimento(rotaAte(planta, estacao, pontoDeAtendimento(item)))).toBeGreaterThan(0);
    }
  });

  it("no começo está no primeiro ponto olhando o primeiro trecho", () => {
    const p = pontoNaRota(rota, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
    expect(p.rotacao).toBeCloseTo(Math.PI / 2); // indo para +x
    expect(pontoNaRota(rota, -3)).toEqual(p);
  });

  it("no meio está no segundo trecho olhando para onde vai", () => {
    const p = pontoNaRota(rota, 2.5);
    expect(p.x).toBeCloseTo(2);
    expect(p.z).toBeCloseTo(0.5);
    expect(p.rotacao).toBeCloseTo(0); // indo para +z
    const q = pontoNaRota(rota, 1);
    expect(q.x).toBeCloseTo(1);
    expect(q.z).toBeCloseTo(0);
  });

  it("no fim fica no último ponto, olhando como chegou", () => {
    for (const d of [5, 7]) {
      const p = pontoNaRota(rota, d);
      expect(p.x).toBeCloseTo(2);
      expect(p.z).toBeCloseTo(3);
      expect(p.rotacao).toBeCloseTo(0);
    }
  });

  it("rota de um ponto só fica parada", () => {
    expect(pontoNaRota([{ x: 1, z: 2 }], 3)).toEqual({ x: 1, z: 2, rotacao: 0 });
  });
});

describe("para qual mesa o garçom vai", () => {
  const AGORA = Date.parse("2026-10-22T21:00:00Z");
  const antes = (segundos: number) => new Date(AGORA - segundos * 1000).toISOString();

  function comEstado(numero: number, estado: EstadoMesa, atendidaHa: number | null): Mesa {
    return mesa(numero, 4, numero, 0, {
      estado,
      atendida_em: atendidaHa === null ? null : antes(atendidaHa),
    });
  }

  function alerta(
    id: number,
    mesaId: number,
    reconhecidoHa: number | null,
    extra: Partial<Alerta> = {},
  ): Alerta {
    return {
      id,
      tipo: "sem_atendimento",
      mesa_id: mesaId,
      mesa_numero: mesaId,
      criado_em: antes(400),
      reconhecido_em: reconhecidoHa === null ? null : antes(reconhecidoHa),
      resolvido_em: null,
      ...extra,
    };
  }

  const mesas = [
    comEstado(1, "aguardando", null),
    comEstado(2, "aguardando", null),
    comEstado(3, "ocupada", 10),
    comEstado(4, "ocupada", 30),
    comEstado(5, "livre", null),
  ];

  it("sem nada para fazer, nenhuma mesa", () => {
    expect(planejarGarcom([comEstado(1, "livre", null)], [], AGORA)).toBeNull();
    expect(planejarGarcom([], [], AGORA)).toBeNull();
  });

  it("alerta com 'Vou atender' vem antes de mesa atendida há pouco", () => {
    expect(planejarGarcom(mesas, [alerta(1, 1, 20)], AGORA)).toEqual({
      mesaId: 1,
      motivo: "indo_atender",
    });
  });

  it("entre dois alertas, vai para o marcado mais recente", () => {
    const alertas = [alerta(1, 1, 60), alerta(2, 2, 5)];
    expect(planejarGarcom(mesas, alertas, AGORA)?.mesaId).toBe(2);
    expect(planejarGarcom(mesas, [...alertas].reverse(), AGORA)?.mesaId).toBe(2);
  });

  it("ignora alerta sem 'Vou atender', resolvido, de mesa vaga ou de mesa que sumiu", () => {
    const alertas = [
      alerta(1, 1, null),
      alerta(2, 2, 5, { resolvido_em: antes(1) }),
      alerta(3, 1, 5, { tipo: "mesa_vaga" }),
      alerta(4, 99, 1),
    ];
    // Sobra só a mesa atendida mais recente.
    expect(planejarGarcom(mesas, alertas, AGORA)).toEqual({ mesaId: 3, motivo: "atendendo" });
  });

  it("fica na mesa atendida mais recente, dentro dos 45 s", () => {
    expect(planejarGarcom(mesas, [], AGORA)).toEqual({ mesaId: 3, motivo: "atendendo" });
    expect(planejarGarcom([comEstado(4, "ocupada", 44)], [], AGORA)?.mesaId).toBe(4);
    expect(planejarGarcom([comEstado(4, "ocupada", 45)], [], AGORA)?.mesaId).toBe(4);
    expect(planejarGarcom([comEstado(4, "ocupada", 46)], [], AGORA)).toBeNull();
  });

  it("só conta mesa ocupada", () => {
    expect(planejarGarcom([comEstado(1, "para_limpar", 5)], [], AGORA)).toBeNull();
    expect(planejarGarcom([comEstado(1, "livre", 5)], [], AGORA)).toBeNull();
  });

  it("relógio do servidor um pouco à frente ainda conta como atendida agora", () => {
    expect(planejarGarcom([comEstado(1, "ocupada", -3)], [], AGORA)?.motivo).toBe("atendendo");
  });

  it("a janela de tempo pode mudar", () => {
    const so = [comEstado(4, "ocupada", 30)];
    expect(planejarGarcom(so, [], AGORA, { janelaAtendendoMs: 20_000 })).toBeNull();
    expect(planejarGarcom(so, [], AGORA, { janelaAtendendoMs: 60_000 })?.mesaId).toBe(4);
  });
});
