// Textos e contas da página do QR da mesa (a do cliente do restaurante), sem tela nenhuma
// (testados em cliente.test.ts).

import type { MesaPublica } from "./tipos";

/** O endereço que vai dentro do QR: <painel>/m/<chave>. */
export function enderecoDoQr(origem: string, chave: string): string {
  return `${origem.replace(/\/$/, "")}/m/${chave}`;
}

/** Os pratos que a casa sugere hoje (só o que ainda tem). */
export function sugestoesDaCasa(mesa: MesaPublica): string[] {
  return mesa.categorias.flatMap((c) =>
    c.itens.filter((i) => i.sugestao && i.disponivel).map((i) => i.nome),
  );
}

export type Motivo = "garcom" | "conta";

/** O texto do botão: muda quando o chamado já foi feito e ainda ninguém chegou. */
export function textoDoBotao(motivo: Motivo, chamados: Motivo[]): string {
  const feito = chamados.includes(motivo);
  if (motivo === "garcom") return feito ? "Garçom a caminho" : "Chamar o garçom";
  return feito ? "Conta a caminho" : "Pedir a conta";
}

export const NOTAS = [
  { nota: 1, texto: "Ruim" },
  { nota: 2, texto: "Fraco" },
  { nota: 3, texto: "Ok" },
  { nota: 4, texto: "Bom" },
  { nota: 5, texto: "Ótimo" },
] as const;
