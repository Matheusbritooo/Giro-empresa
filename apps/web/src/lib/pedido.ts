// Contas da tela de pedido e da cozinha, sem tela nenhuma (testadas em pedido.test.ts).

import type { Cardapio, ItemCardapio, ItemCozinha, ItemPedido } from "./tipos";

/** Preço do cardápio: "R$ 62" ou "R$ 12,50" (com centavos só quando tem). */
export function preco(centavos: number): string {
  const casas = centavos % 100 === 0 ? 0 : 2;
  return `R$ ${(centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}`;
}

/** "120" ou "12,5" no campo de reais vira centavos; texto que não é número vira null. */
export function centavosDoCampo(texto: string): number | null {
  const limpo = texto
    .trim()
    .replace(/\s|R\$/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Math.round(Number(limpo) * 100);
}

/** O campo de reais mostrando o valor guardado: 1250 vira "12,50". */
export function campoDosCentavos(centavos: number | null): string {
  if (centavos === null) return "";
  return centavos % 100 === 0
    ? String(centavos / 100)
    : (centavos / 100).toFixed(2).replace(".", ",");
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type Filtro = "mais" | number; // "mais pedidos" ou o id da categoria

/** Os itens que aparecem para escolher: os mais pedidos, uma categoria ou a busca. */
export function itensParaEscolher(
  cardapio: Cardapio,
  filtro: Filtro,
  busca: string,
): ItemCardapio[] {
  const ativas = new Set(cardapio.categorias.filter((c) => c.ativa).map((c) => c.id));
  const ativos = cardapio.itens.filter((i) => i.ativo && ativas.has(i.categoria_id));
  const termo = semAcento(busca.trim());
  if (termo) return ativos.filter((i) => semAcento(i.nome).includes(termo));
  if (filtro === "mais") {
    const porId = new Map(ativos.map((i) => [i.id, i]));
    const mais = cardapio.mais_pedidos
      .map((id) => porId.get(id))
      .filter((i): i is ItemCardapio => !!i);
    // Restaurante novo, sem pedidos ainda: começa pelo cardápio na ordem.
    return mais.length ? mais : ativos.slice(0, 8);
  }
  return ativos.filter((i) => i.categoria_id === filtro);
}

/** Uma linha do pedido que o garçom está montando, antes de lançar. */
export interface LinhaRascunho {
  itemId: number;
  quantidade: number;
  observacao: string;
}

export function adicionar(rascunho: LinhaRascunho[], itemId: number): LinhaRascunho[] {
  const existe = rascunho.find((l) => l.itemId === itemId);
  if (!existe) return [...rascunho, { itemId, quantidade: 1, observacao: "" }];
  return rascunho.map((l) => (l.itemId === itemId ? { ...l, quantidade: l.quantidade + 1 } : l));
}

export function tirar(rascunho: LinhaRascunho[], itemId: number): LinhaRascunho[] {
  return rascunho
    .map((l) => (l.itemId === itemId ? { ...l, quantidade: l.quantidade - 1 } : l))
    .filter((l) => l.quantidade > 0);
}

export function totalDoRascunho(rascunho: LinhaRascunho[], itens: ItemCardapio[]): number {
  const porId = new Map(itens.map((i) => [i.id, i]));
  return rascunho.reduce(
    (soma, l) => soma + (porId.get(l.itemId)?.preco_centavos ?? 0) * l.quantidade,
    0,
  );
}

export function quantidadeNoRascunho(rascunho: LinhaRascunho[]): number {
  return rascunho.reduce((soma, l) => soma + l.quantidade, 0);
}

export type SituacaoItem = "na_cozinha" | "pronto" | "cancelado";

export function situacaoDoItem(item: ItemPedido): SituacaoItem {
  if (item.cancelado_em) return "cancelado";
  return item.pronto_em ? "pronto" : "na_cozinha";
}

/** Um lançamento na cozinha: os itens que a mesma mesa pediu de uma vez. */
export interface Lancamento {
  chave: string;
  mesaNumero: number;
  lancadoEm: string;
  itens: ItemCozinha[];
}

/** Agrupa a fila da cozinha por lançamento, do mais antigo para o mais novo. */
export function lancamentosDaCozinha(fila: ItemCozinha[]): Lancamento[] {
  const grupos: Lancamento[] = [];
  for (const item of [...fila].sort(
    (a, b) => Date.parse(a.lancado_em) - Date.parse(b.lancado_em) || a.id - b.id,
  )) {
    const chave = `${item.mesa_id}-${item.lancado_em}`;
    const grupo = grupos.find((g) => g.chave === chave);
    if (grupo) grupo.itens.push(item);
    else
      grupos.push({
        chave,
        mesaNumero: item.mesa_numero,
        lancadoEm: item.lancado_em,
        itens: [item],
      });
  }
  return grupos;
}
