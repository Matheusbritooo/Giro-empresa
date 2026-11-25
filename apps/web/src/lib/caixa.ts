// Contas e textos da conferência com o caixa (testadas em caixa.test.ts).

import { reais } from "./resultados";
import type { ConferenciaCaixa } from "./tipos";

/** O arquivo do caixa em texto. Muito sistema de caixa ainda exporta no formato antigo do
 * Windows (acentos quebram em UTF-8): se não for UTF-8 válido, lê nesse formato. */
export function textoDoArquivo(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Quanto do que o caixa vendeu o GIRO viu: "87%" (ou null sem caixa). */
export function parteVista(c: Pick<ConferenciaCaixa, "caixa_centavos" | "giro_centavos">) {
  if (c.caixa_centavos <= 0) return null;
  return `${Math.round((Math.min(c.giro_centavos, c.caixa_centavos) / c.caixa_centavos) * 100)}%`;
}

/** "R$ 340 sem pedido no GIRO", "R$ 25 a mais no GIRO" ou "bateu". Diferença de até R$ 1 bate. */
export function textoDaDiferenca(caixa: number, giro: number): string {
  const diferenca = caixa - giro;
  if (Math.abs(diferenca) < 100) return "bateu";
  return diferenca > 0
    ? `${reais(diferenca)} sem pedido no GIRO`
    : `${reais(-diferenca)} a mais no GIRO`;
}

/** O resumo da conferência numa frase. */
export function resumoDaConferencia(c: ConferenciaCaixa): string {
  const noites =
    c.noites.length === 1 ? "Na noite do caixa" : `Nas ${c.noites.length} noites do caixa`;
  const sem = c.caixa_centavos - c.giro_centavos;
  if (Math.abs(sem) < 100) {
    return `${noites}, tudo o que foi vendido passou pelo GIRO.`;
  }
  return sem > 0
    ? `${noites}, ${reais(sem)} foram vendidos sem pedido no GIRO: o estoque não baixou e os resultados não viram essas vendas.`
    : `${noites}, o GIRO tem ${reais(-sem)} a mais que o caixa: confira se algum pedido lançado não foi cobrado.`;
}
