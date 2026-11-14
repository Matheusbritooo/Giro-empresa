// Pedido sem internet: o que o garçom lançou e ainda não chegou no servidor fica guardado no
// aparelho e sobe sozinho quando a rede volta. As contas ficam aqui, sem tela (testadas em
// fila-pedidos.test.ts). Guarda só mesa e itens: nada de quem está sentado.

/** Um pedido lançado sem rede, esperando para subir. */
export interface PedidoNaFila {
  /** Inventada no aparelho: o servidor não lança duas vezes o pedido com a mesma chave. */
  chave: string;
  /** Quem lançou: só a conta dele envia (o pedido leva o nome de quem lançou). */
  usuarioId: number;
  mesaId: number;
  mesaNumero: number;
  itens: { item_id: number; nome: string; quantidade: number; observacao: string | null }[];
  guardadoEm: number; // ms
  /** O servidor não aceitou (acabou um item, mesa desativada): o motivo, para o garçom ver. */
  recusado?: string;
}

/** Até este tempo guardado, o pedido sobe sozinho. Depois, o garçom confirma: a mesa pode já
 * ter sido atendida de outro jeito, e pedido velho chegando sozinho na cozinha é pior. */
export const ENVIO_SOZINHO_MS = 10 * 60_000;

const CHAVE_DO_APARELHO = "giro:fila-pedidos";

/** Identificador único do lançamento. Sem https o navegador não tem randomUUID: monta um. */
export function novaChave(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Os que sobem sozinhos agora: desta conta, ainda não recusados e guardados há pouco. */
export function paraEnviar(fila: PedidoNaFila[], usuarioId: number, agoraMs: number) {
  return fila.filter(
    (p) => p.usuarioId === usuarioId && !p.recusado && agoraMs - p.guardadoEm <= ENVIO_SOZINHO_MS,
  );
}

/** Guardados há tempo demais: esperam o garçom dizer se ainda valem. */
export function paraConfirmar(fila: PedidoNaFila[], usuarioId: number, agoraMs: number) {
  return fila.filter(
    (p) => p.usuarioId === usuarioId && !p.recusado && agoraMs - p.guardadoEm > ENVIO_SOZINHO_MS,
  );
}

export function recusados(fila: PedidoNaFila[], usuarioId: number) {
  return fila.filter((p) => p.usuarioId === usuarioId && !!p.recusado);
}

/** O servidor respondeu que esse pedido não entra, e tentar de novo não muda nada. Sem
 * resposta (0), sessão vencida (401) ou erro do servidor (5xx), o pedido continua na fila. */
export function foiRecusado(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export function textoDaFila(quantos: number): string {
  return quantos === 1 ? "1 pedido na fila" : `${quantos} pedidos na fila`;
}

/** "há 25 min" para o pedido que ficou guardado tempo demais. */
export function haQuanto(guardadoEm: number, agoraMs: number): string {
  const minutos = Math.max(1, Math.round((agoraMs - guardadoEm) / 60_000));
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `há ${horas} h${minutos % 60 ? ` ${minutos % 60} min` : ""}`;
}

// A fila em si: uma lista pequena guardada no aparelho. Quem está na tela é avisado a cada
// mudança (useSyncExternalStore pede a mesma lista enquanto nada mudou).
const VAZIA: PedidoNaFila[] = [];
let fila: PedidoNaFila[] | null = null;
const ouvintes = new Set<() => void>();

function ler(): PedidoNaFila[] {
  try {
    const texto = window.localStorage.getItem(CHAVE_DO_APARELHO);
    const lista = texto ? (JSON.parse(texto) as unknown) : [];
    return Array.isArray(lista) ? (lista as PedidoNaFila[]) : [];
  } catch {
    return []; // aparelho sem armazenamento (aba anônima): a fila vale só enquanto aberta
  }
}

function gravar(nova: PedidoNaFila[]): void {
  fila = nova;
  try {
    window.localStorage.setItem(CHAVE_DO_APARELHO, JSON.stringify(nova));
  } catch {
    // sem armazenamento: segue só na memória
  }
  for (const ouvinte of ouvintes) ouvinte();
}

export function filaAtual(): PedidoNaFila[] {
  fila ??= ler();
  return fila;
}

export function filaNoServidor(): PedidoNaFila[] {
  return VAZIA;
}

export function ouvirFila(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function enfileirar(pedido: PedidoNaFila): void {
  gravar([...filaAtual(), pedido]);
}

export function tirarDaFila(chave: string): void {
  gravar(filaAtual().filter((p) => p.chave !== chave));
}

export function marcarRecusado(chave: string, motivo: string): void {
  gravar(filaAtual().map((p) => (p.chave === chave ? { ...p, recusado: motivo } : p)));
}

/** O garçom confirmou que o pedido guardado há tempo ainda vale: volta a subir sozinho. */
export function renovar(chave: string, agoraMs: number): void {
  gravar(filaAtual().map((p) => (p.chave === chave ? { ...p, guardadoEm: agoraMs } : p)));
}

// Quem está com a mesa aberta quer saber na hora que o pedido dela subiu, sem esperar o canal
// ao vivo reconectar.
const ouvintesDeEnvio = new Set<(mesaId: number) => void>();

export function ouvirEnvios(ouvinte: (mesaId: number) => void): () => void {
  ouvintesDeEnvio.add(ouvinte);
  return () => ouvintesDeEnvio.delete(ouvinte);
}

export function avisarEnvio(mesaId: number): void {
  for (const ouvinte of ouvintesDeEnvio) ouvinte(mesaId);
}
