// Contas e textos do relatório do mês, sem tela nenhuma (testadas em relatorio.test.ts).

import { DIAS } from "./resultados";
import type { RelatorioDoMes } from "./tipos";

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-10-01" ou "2026-10" vira "outubro de 2026". */
export function nomeDoMes(mes: string): string {
  const [ano, numero] = mes.split("-");
  return `${MESES[Number(numero) - 1]} de ${ano}`;
}

/** "2026-10" a partir de "2026-10-01". */
export function chaveDoMes(mes: string): string {
  return mes.slice(0, 7);
}

/** Os últimos `quantos` meses, do atual para trás: ["2026-11", "2026-10", ...]. */
export function ultimosMeses(hoje: string, quantos = 12): string[] {
  let [ano, mes] = hoje.split("-").map(Number);
  const meses: string[] = [];
  for (let i = 0; i < quantos; i++) {
    meses.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  }
  return meses;
}

/** O mês pedido na URL, se for um dos últimos 12; senão, o mês atual. */
export function mesEscolhido(pedido: string | null, hoje: string): string {
  const meses = ultimosMeses(hoje, 12);
  return pedido && meses.includes(pedido) ? pedido : meses[0];
}

/** Com o que os números se comparam: "que outubro" (mês fechado), "que o mesmo período de
 * outubro" (mês em andamento) ou null, quando o GIRO não estava em uso no mês anterior. */
export function comparadoCom(r: Pick<RelatorioDoMes, "completo" | "comparado_de">): string | null {
  if (!r.comparado_de) return null;
  const mes = MESES[Number(r.comparado_de.slice(5, 7)) - 1];
  return r.completo ? `que ${mes}` : `que o mesmo período de ${mes}`;
}

/** "+12%" / "−8%" / "igual"; sem base para comparar, null. */
export function variacao(atual: number, antes: number): string | null {
  if (antes <= 0) return null;
  const pct = Math.round((atual / antes - 1) * 100);
  if (pct === 0) return "igual";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

function dinheiro(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function minutos(segundos: number | null): string {
  return segundos === null
    ? ""
    : (segundos / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function celula(valor: string): string {
  return /[;"\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/**
 * A planilha do mês, noite a noite, para abrir no Excel ou no Google Planilhas: separada por
 * ponto e vírgula e com vírgula nos decimais (o jeito do Excel em português), e com a marca
 * do UTF-8 no começo para os acentos aparecerem certos.
 */
export function planilhaDoMes(r: RelatorioDoMes): string {
  const cabecalho = [
    "Noite",
    "Dia da semana",
    "Mesas atendidas",
    "Pessoas",
    "Foram embora sem atendimento",
    "Vendeu (R$)",
    "Ficou na mesa (R$)",
    "Espera até o atendimento (min)",
    "Mesa parada suja (min)",
    "Nota dos clientes",
  ];
  const linhas = r.noites.map((n) => {
    const [ano, mes, dia] = n.dia.split("-");
    return [
      `${dia}/${mes}/${ano}`,
      DIAS[new Date(`${n.dia}T12:00:00Z`).getUTCDay()],
      String(n.mesas_atendidas),
      String(n.pessoas),
      String(n.desistencias),
      dinheiro(n.vendeu_centavos),
      dinheiro(n.ficou_na_mesa_centavos),
      minutos(n.espera_media_seg),
      minutos(n.parada_media_seg),
      n.nota_media === null
        ? ""
        : n.nota_media.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
    ];
  });
  const total = [
    "Total do mês",
    "",
    String(r.mesas_atendidas),
    String(r.pessoas),
    String(r.desistencias),
    dinheiro(r.vendeu_centavos),
    dinheiro(r.ficou_na_mesa_centavos),
    minutos(r.espera_media_seg),
    minutos(r.parada_media_seg),
    r.notas.media === null
      ? ""
      : r.notas.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
  ];
  const texto = [cabecalho, ...linhas, total].map((l) => l.map(celula).join(";")).join("\r\n");
  return `﻿${texto}\r\n`;
}

/** "giro-cantina-do-marcos-2026-10.csv" */
export function nomeDaPlanilha(restaurante: string, mes: string): string {
  const nome = restaurante
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `giro-${nome || "restaurante"}-${chaveDoMes(mes)}.csv`;
}
