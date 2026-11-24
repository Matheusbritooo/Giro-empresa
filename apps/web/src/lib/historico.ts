// Contas e textos do histórico de quem fez o quê (testadas em historico.test.ts).

import { horaLocal, rotuloDia, somarDias } from "./resultados";
import type { Atividade, GrupoAtividade } from "./tipos";

export const GRUPOS: { valor: GrupoAtividade; texto: string }[] = [
  { valor: "cardapio", texto: "Cardápio e preços" },
  { valor: "pedido", texto: "Pedidos cancelados" },
  { valor: "estoque", texto: "Estoque" },
  { valor: "equipe", texto: "Equipe" },
  { valor: "ajustes", texto: "Ajustes" },
  { valor: "mesas", texto: "Mesas e câmeras" },
];

export const PERIODOS = [
  { valor: "semana", texto: "7 dias" },
  { valor: "mes", texto: "30 dias" },
  { valor: "trimestre", texto: "3 meses" },
] as const;

export type PeriodoHistorico = (typeof PERIODOS)[number]["valor"];

export function lerPeriodoHistorico(valor: string | null): PeriodoHistorico {
  return PERIODOS.some((p) => p.valor === valor) ? (valor as PeriodoHistorico) : "semana";
}

export function lerGrupo(valor: string | null): GrupoAtividade | null {
  return GRUPOS.some((g) => g.valor === valor) ? (valor as GrupoAtividade) : null;
}

/** O dia do calendário (não a noite) em São Paulo, AAAA-MM-DD. */
export function diaLocal(instante: string): string {
  return new Date(Date.parse(instante) - 3 * 3600_000).toISOString().slice(0, 10);
}

export interface DiaDoHistorico {
  dia: string;
  rotulo: string; // "Hoje", "Ontem" ou "sexta, 21/11"
  linhas: { id: number; hora: string; texto: string; quem: string }[];
}

/** As atividades (da mais nova para a mais antiga) separadas por dia. */
export function porDia(atividades: Atividade[], hoje: string): DiaDoHistorico[] {
  const dias: DiaDoHistorico[] = [];
  for (const a of atividades) {
    const dia = diaLocal(a.em);
    if (dias.at(-1)?.dia !== dia) {
      const rotulo = dia === hoje ? "Hoje" : dia === somarDias(hoje, -1) ? "Ontem" : rotuloDia(dia);
      dias.push({ dia, rotulo, linhas: [] });
    }
    dias.at(-1)?.linhas.push({
      id: a.id,
      hora: horaLocal(a.em),
      texto: a.texto,
      quem: a.quem ?? "GIRO",
    });
  }
  return dias;
}
