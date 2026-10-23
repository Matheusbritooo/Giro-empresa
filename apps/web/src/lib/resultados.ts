// Contas e textos da tela de Resultados. Mesmas regras do servidor (giro/dominio/indicadores.py):
// horário de São Paulo (UTC-3 o ano todo) e a noite vai das 6h às 6h do dia seguinte.

import type { Periodo } from "./tipos";

const FUSO_MS = -3 * 3600_000;
const VIRADA_H = 6;
const DIA_MS = 86_400_000;

export const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** O instante como se o relógio de São Paulo fosse UTC (para ler hora e dia sem o fuso do aparelho). */
function local(ms: number): Date {
  return new Date(ms + FUSO_MS);
}

function isoDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A noite (AAAA-MM-DD) a que um instante pertence: antes das 6h ainda é a noite anterior. */
export function noiteDe(ms: number): string {
  const l = local(ms);
  return isoDia(l.getUTCHours() < VIRADA_H ? new Date(l.getTime() - DIA_MS) : l);
}

export function somarDias(dia: string, dias: number): string {
  return isoDia(new Date(Date.parse(`${dia}T12:00:00Z`) + dias * DIA_MS));
}

/** Antes do horário de abertura, a noite que interessa é a de ontem (a de hoje nem começou). */
export function noitePadrao(agoraMs: number, abreAs: string): string {
  const noite = noiteDe(agoraMs);
  const l = local(agoraMs);
  const [h, m] = abreAs.split(":").map(Number);
  const minutosAgora = l.getUTCHours() * 60 + l.getUTCMinutes();
  const antesDaAbertura = l.getUTCHours() >= VIRADA_H && minutosAgora < h * 60 + m;
  return antesDaAbertura ? somarDias(noite, -1) : noite;
}

export function diaDaSemana(dia: string): string {
  return DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()];
}

/** "sexta, 16/10" */
export function rotuloDia(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${diaDaSemana(dia)}, ${d}/${mes}`;
}

/** "20:31", sempre no horário do restaurante, seja qual for o fuso do aparelho. */
export function horaLocal(instante: string | number): string {
  const ms = typeof instante === "number" ? instante : Date.parse(instante);
  return local(ms).toISOString().slice(11, 16);
}

/** "R$ 1.213" (sem centavos: é estimativa). */
export function reais(centavos: number): string {
  const valor = Math.round(Math.abs(centavos) / 100).toLocaleString("pt-BR");
  return `${centavos < 0 ? "-" : ""}R$ ${valor}`;
}

/** "6,5 min" ou "1h05"; sem dado, um traço. */
export function minutos(segundos: number | null): string {
  if (segundos === null) return "–";
  const min = segundos / 60;
  if (min >= 60) return `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
  return `${min.toLocaleString("pt-BR", { maximumFractionDigits: min < 10 ? 1 : 0 })} min`;
}

export function decimal(valor: number, casas = 1): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function nomeDoAnterior(periodo: Periodo, dia: string): string {
  if (periodo === "noite") {
    const nome = diaDaSemana(dia);
    return nome === "sábado" || nome === "domingo" ? `o ${nome} passado` : `a ${nome} passada`;
  }
  return periodo === "semana" ? "os 7 dias anteriores" : "as 4 semanas anteriores";
}

export interface Comparacao {
  texto: string;
  tom: "melhor" | "pior" | "igual";
}

/**
 * "18% a menos que a sexta passada". `menorEMelhor` diz para que lado é bom (dinheiro perdido
 * e espera: menos é melhor; mesas atendidas: mais é melhor).
 */
export function comparar(
  atual: number | null,
  anterior: number | null,
  menorEMelhor: boolean,
  nomeAnterior: string,
): Comparacao | null {
  if (atual === null || anterior === null) return null;
  if (anterior === 0) {
    if (atual === 0) return { texto: `o mesmo que ${nomeAnterior}`, tom: "igual" };
    return { texto: `${nomeAnterior} teve zero`, tom: menorEMelhor ? "pior" : "melhor" };
  }
  const variacao = Math.round(((atual - anterior) / anterior) * 100);
  if (variacao === 0) return { texto: `o mesmo que ${nomeAnterior}`, tom: "igual" };
  const subiu = variacao > 0;
  return {
    texto: `${Math.abs(variacao)}% a ${subiu ? "mais" : "menos"} que ${nomeAnterior}`,
    tom: subiu === menorEMelhor ? "pior" : "melhor",
  };
}

const PERIODOS: Periodo[] = ["noite", "semana", "mes"];

/** Período vindo da URL; qualquer outra coisa vira "noite". */
export function lerPeriodo(valor: string | null): Periodo {
  return PERIODOS.includes(valor as Periodo) ? (valor as Periodo) : "noite";
}

/** Dia (AAAA-MM-DD) vindo da URL, ou null se não for uma data de verdade. */
export function lerDia(valor: string | null): string | null {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  return isoDia(new Date(`${valor}T12:00:00Z`)) === valor ? valor : null;
}

/** Quantos dias anda o "anterior / próximo" de cada período. */
export const PASSO_DIAS: Record<Periodo, number> = { noite: 1, semana: 7, mes: 28 };

/** O mesmo endereço com alguns parâmetros trocados (mantém o restaurante da equipe GIRO). */
export function comBusca(
  caminho: string,
  atual: URLSearchParams,
  mudar: Record<string, string | null>,
): string {
  const busca = new URLSearchParams(atual);
  for (const [chave, valor] of Object.entries(mudar)) {
    if (valor === null) busca.delete(chave);
    else busca.set(chave, valor);
  }
  const texto = busca.toString();
  return texto ? `${caminho}?${texto}` : caminho;
}
