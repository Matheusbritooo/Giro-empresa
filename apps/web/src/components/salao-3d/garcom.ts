/**
 * Por onde anda o garçom do salão em 3D e para qual mesa ele vai. Só contas, sem React nem
 * three.js, para dar para testar. Mesma convenção da planta: metro, piso centrado na
 * origem, rotação em y = atan2(dx, dz) (algo de frente para +z passa a olhar para (dx, dz)).
 */

import type { Alerta, Mesa } from "@/lib/tipos";

import type { MesaNoSalao, PlantaSalao } from "./planta";

export interface Ponto {
  x: number;
  z: number;
}

/** Ponto com a rotação em y de quem está nele. */
export interface PontoComRotacao extends Ponto {
  rotacao: number;
}

/** Folga entre o garçom e a pegada de qualquer mesa (mesa + cadeiras) enquanto anda. */
export const FOLGA_ROTA = 0.15;
/** Onde o garçom para ao lado da mesa: esta distância para fora da pegada. */
export const AFASTAMENTO_ATENDIMENTO = 0.3;
/** Por quanto tempo depois de atender o garçom continua junto da mesa. */
export const JANELA_ATENDENDO_MS = 45_000;

/**
 * Cada curva no caminho custa como andar este tanto a mais em linha reta. Entre dois
 * caminhos do mesmo tamanho, o garçom prefere o que vira menos.
 */
const CUSTO_CURVA = 0.6;
/**
 * Andar fora dos corredores (rente à parede, entre o balcão e as mesas) custa este tanto a
 * mais por metro. O garçom só sai do corredor para chegar ou sair do ponto pedido.
 */
const FATOR_FORA_DO_CORREDOR = 1.5;
const EPS = 1e-9;

// O balcão (sala.tsx) fica junto à parede da esquerda, começa 1,1 m depois da parede do
// fundo e tem banquetas até ~1,25 m da parede. O garçom espera logo depois das banquetas.
const BALCAO_RECUO_FUNDO = 1.1;
const ESTACAO_DA_PAREDE_ESQUERDA = 1.6;

/** Onde o garçom espera quando não tem mesa para atender: junto ao balcão, no fundo à esquerda. */
export function estacaoDoGarcom(planta: PlantaSalao): PontoComRotacao {
  const esquerda = -planta.largura / 2;
  const fundo = -planta.profundidade / 2;
  // Olhando para o salão, na diagonal para a frente e a direita.
  return {
    x: esquerda + ESTACAO_DA_PAREDE_ESQUERDA,
    z: fundo + BALCAO_RECUO_FUNDO,
    rotacao: Math.atan2(1, 1),
  };
}

export type LadoDaMesa = "direita" | "esquerda" | "frente" | "fundo";

/**
 * Onde o garçom para para atender: do lado escolhido da mesa (direita por padrão, para
 * não tapar a mesa na vista de frente), fora das cadeiras, na direção do corredor, e
 * virado para o centro da mesa.
 */
export function pontoDeAtendimento(
  item: MesaNoSalao,
  lado: LadoDaMesa = "direita",
): PontoComRotacao {
  const fora = AFASTAMENTO_ATENDIMENTO;
  const { x: mx, z: mz } = item.meiaPegada;
  const deslocamento: Record<LadoDaMesa, Ponto> = {
    direita: { x: mx + fora, z: 0 },
    esquerda: { x: -(mx + fora), z: 0 },
    frente: { x: 0, z: mz + fora },
    fundo: { x: 0, z: -(mz + fora) },
  };
  const d = deslocamento[lado];
  return { x: item.x + d.x, z: item.z + d.z, rotacao: Math.atan2(-d.x, -d.z) };
}

interface Caixa {
  x: number;
  z: number;
  mx: number;
  mz: number;
}

function caixasDasMesas(planta: PlantaSalao, folga: number): Caixa[] {
  return planta.mesas.map((m) => ({
    x: m.x,
    z: m.z,
    mx: m.meiaPegada.x + folga,
    mz: m.meiaPegada.z + folga,
  }));
}

function dentroDaCaixa(p: Ponto, c: Caixa): boolean {
  return Math.abs(p.x - c.x) < c.mx - EPS && Math.abs(p.z - c.z) < c.mz - EPS;
}

/** Um trecho reto (só em x ou só em z) passa por dentro da caixa? */
function trechoCruza(a: Ponto, b: Ponto, c: Caixa): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minZ = Math.min(a.z, b.z);
  const maxZ = Math.max(a.z, b.z);
  return (
    maxX > c.x - c.mx + EPS &&
    minX < c.x + c.mx - EPS &&
    maxZ > c.z - c.mz + EPS &&
    minZ < c.z + c.mz - EPS
  );
}

function valoresUnicos(valores: number[]): number[] {
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados.filter((v, i) => i === 0 || Math.abs(v - ordenados[i - 1]) > 1e-7);
}

function naFaixa(faixas: number[], v: number): boolean {
  return faixas.some((f) => Math.abs(f - v) < 1e-7);
}

function indiceDe(valores: number[], v: number): number {
  let melhor = 0;
  for (let i = 1; i < valores.length; i++) {
    if (Math.abs(valores[i] - v) < Math.abs(valores[melhor] - v)) melhor = i;
  }
  return melhor;
}

/** Tira pontos repetidos e os do meio de três pontos na mesma reta. */
export function simplificarRota(pontos: Ponto[]): Ponto[] {
  const semRepetir: Ponto[] = [];
  for (const p of pontos) {
    const ultimo = semRepetir[semRepetir.length - 1];
    if (!ultimo || Math.hypot(p.x - ultimo.x, p.z - ultimo.z) > 1e-7) semRepetir.push(p);
  }
  const rota: Ponto[] = [];
  for (const p of semRepetir) {
    while (rota.length >= 2) {
      const a = rota[rota.length - 2];
      const b = rota[rota.length - 1];
      const cruz = (b.x - a.x) * (p.z - b.z) - (b.z - a.z) * (p.x - b.x);
      const mesmoSentido = (b.x - a.x) * (p.x - b.x) + (b.z - a.z) * (p.z - b.z) > 0;
      if (Math.abs(cruz) < 1e-9 && mesmoSentido) rota.pop();
      else break;
    }
    rota.push(p);
  }
  return rota;
}

/**
 * Caminho do garçom de `de` até `para` em trechos retos (só em x ou só em z), pelos
 * corredores da planta, sem nunca entrar na pegada de uma mesa com folga de `FOLGA_ROTA`.
 * Começa em `de`, termina em `para` e não tem ponto repetido nem três pontos em linha.
 *
 * Por dentro: uma grade com as faixas dos corredores mais as linhas que passam por `de` e
 * por `para`; o caminho mais curto nela, com um custo a mais por curva.
 */
export function rotaAte(planta: PlantaSalao, de: Ponto, para: Ponto): Ponto[] {
  const inicio = { x: de.x, z: de.z };
  const fim = { x: para.x, z: para.z };
  if (Math.hypot(inicio.x - fim.x, inicio.z - fim.z) < 1e-7) return [inicio];

  const caixas = caixasDasMesas(planta, FOLGA_ROTA);
  // Se a ponta já está dentro de uma pegada (garçom no meio de uma mesa), ela não bloqueia
  // a saída: o garçom sai dela pelo caminho mais curto.
  const ignorar = new Set(
    caixas.flatMap((c, i) => (dentroDaCaixa(inicio, c) || dentroDaCaixa(fim, c) ? [i] : [])),
  );
  const livre = (a: Ponto, b: Ponto) =>
    caixas.every((c, i) => ignorar.has(i) || !trechoCruza(a, b, c));

  const xs = valoresUnicos([...planta.corredoresX, inicio.x, fim.x]);
  const zs = valoresUnicos([...planta.corredoresZ, inicio.z, fim.z]);
  const nx = xs.length;
  const nz = zs.length;
  const ponto = (n: number): Ponto => ({ x: xs[n % nx], z: zs[Math.floor(n / nx)] });
  const no = (ix: number, iz: number) => iz * nx + ix;
  const origem = no(indiceDe(xs, inicio.x), indiceDe(zs, inicio.z));
  const destino = no(indiceDe(xs, fim.x), indiceDe(zs, fim.z));

  // Dijkstra com estado (nó, direção de chegada) para cobrar as curvas.
  // Direções: 0 = +x, 1 = -x, 2 = +z, 3 = -z, 4 = parado (só na origem).
  const passos = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  const estados = nx * nz * 5;
  const custo = new Float64Array(estados).fill(Number.POSITIVE_INFINITY);
  const anterior = new Int32Array(estados).fill(-1);
  const feito = new Uint8Array(estados);
  const partida = origem * 5 + 4;
  custo[partida] = 0;

  let chegada = -1;
  for (;;) {
    let atual = -1;
    for (let s = 0; s < estados; s++) {
      if (!feito[s] && (atual < 0 || custo[s] < custo[atual])) atual = s;
    }
    if (atual < 0 || !Number.isFinite(custo[atual])) break;
    feito[atual] = 1;
    const n = Math.floor(atual / 5);
    const dirAtual = atual % 5;
    if (n === destino) {
      chegada = atual;
      break;
    }
    const ix = n % nx;
    const iz = Math.floor(n / nx);
    for (let d = 0; d < 4; d++) {
      const jx = ix + passos[d][0];
      const jz = iz + passos[d][1];
      if (jx < 0 || jx >= nx || jz < 0 || jz >= nz) continue;
      const vizinho = no(jx, jz);
      const a = ponto(n);
      const b = ponto(vizinho);
      if (!livre(a, b)) continue;
      const curva = dirAtual !== 4 && dirAtual !== d ? CUSTO_CURVA : 0;
      const noCorredor =
        d < 2 ? naFaixa(planta.corredoresZ, a.z) : naFaixa(planta.corredoresX, a.x);
      const fator = noCorredor ? 1 : FATOR_FORA_DO_CORREDOR;
      const novo = custo[atual] + Math.hypot(b.x - a.x, b.z - a.z) * fator + curva;
      const s = vizinho * 5 + d;
      if (novo < custo[s] - 1e-12) {
        custo[s] = novo;
        anterior[s] = atual;
      }
    }
  }

  if (chegada < 0) {
    // Não deveria acontecer: os corredores sempre se ligam. Vai em L, como der.
    return simplificarRota([inicio, { x: fim.x, z: inicio.z }, fim]);
  }
  const caminho: Ponto[] = [];
  for (let s = chegada; s >= 0; s = anterior[s]) caminho.push(ponto(Math.floor(s / 5)));
  caminho.reverse();
  // As pontas exatas, sem o arredondamento da grade.
  caminho[0] = inicio;
  caminho[caminho.length - 1] = fim;
  return simplificarRota(caminho);
}

/** Tamanho do caminho, em metros. */
export function comprimento(rota: Ponto[]): number {
  let total = 0;
  for (let i = 1; i < rota.length; i++) {
    total += Math.hypot(rota[i].x - rota[i - 1].x, rota[i].z - rota[i - 1].z);
  }
  return total;
}

/**
 * Onde está quem já andou `distancia` metros pela rota, olhando para onde está indo.
 * Antes do começo fica no começo; depois do fim fica no fim, olhando como chegou.
 */
export function pontoNaRota(rota: Ponto[], distancia: number): PontoComRotacao {
  if (rota.length === 0) return { x: 0, z: 0, rotacao: 0 };
  if (rota.length === 1) return { x: rota[0].x, z: rota[0].z, rotacao: 0 };
  let resta = Math.max(0, distancia);
  for (let i = 1; i < rota.length; i++) {
    const a = rota[i - 1];
    const b = rota[i];
    const trecho = Math.hypot(b.x - a.x, b.z - a.z);
    const rotacao = Math.atan2(b.x - a.x, b.z - a.z);
    if (resta <= trecho || i === rota.length - 1) {
      const t = trecho > 0 ? Math.min(1, resta / trecho) : 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, rotacao };
    }
    resta -= trecho;
  }
  // Inalcançável: o laço sempre devolve no último trecho.
  const ultimo = rota[rota.length - 1];
  return { x: ultimo.x, z: ultimo.z, rotacao: 0 };
}

export type MotivoGarcom = "indo_atender" | "atendendo";

export interface PlanoGarcom {
  mesaId: number;
  motivo: MotivoGarcom;
}

export interface OpcoesGarcom {
  /** Por quanto tempo depois de `atendida_em` o garçom fica junto da mesa. */
  janelaAtendendoMs?: number;
}

function quando(texto: string | null): number | null {
  if (!texto) return null;
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Para qual mesa o garçom do 3D vai agora.
 * 1. Alerta de cliente sem atendimento que alguém marcou "Vou atender" e ainda não foi
 *    resolvido: vai até a mesa (o marcado mais recente primeiro).
 * 2. Senão, mesa ocupada que foi atendida há pouco (`janelaAtendendoMs`, 45 s): fica nela
 *    atendendo (a atendida mais recente primeiro).
 * 3. Senão, nenhuma: o garçom volta para perto do balcão.
 */
export function planejarGarcom(
  mesas: Mesa[],
  alertas: Alerta[],
  agoraMs: number,
  opcoes: OpcoesGarcom = {},
): PlanoGarcom | null {
  const janela = opcoes.janelaAtendendoMs ?? JANELA_ATENDENDO_MS;
  const existe = new Set(mesas.map((m) => m.id));

  let alerta: { mesaId: number; ms: number } | null = null;
  for (const a of alertas) {
    if (a.tipo !== "sem_atendimento" || a.resolvido_em !== null) continue;
    const ms = quando(a.reconhecido_em);
    if (ms === null || !existe.has(a.mesa_id)) continue;
    if (!alerta || ms > alerta.ms) alerta = { mesaId: a.mesa_id, ms };
  }
  if (alerta) return { mesaId: alerta.mesaId, motivo: "indo_atender" };

  let atendida: { mesaId: number; ms: number } | null = null;
  for (const m of mesas) {
    if (m.estado !== "ocupada") continue;
    const ms = quando(m.atendida_em);
    // Relógio do servidor um pouco à frente do aparelho conta como "agora mesmo".
    if (ms === null || agoraMs - ms > janela) continue;
    if (!atendida || ms > atendida.ms) atendida = { mesaId: m.id, ms };
  }
  if (atendida) return { mesaId: atendida.mesaId, motivo: "atendendo" };

  return null;
}
