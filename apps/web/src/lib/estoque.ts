// Contas da tela de estoque, sem tela nenhuma (testadas em estoque.test.ts).
// Quantidade sempre na unidade base do ingrediente: grama, mililitro ou unidade.

import { preco } from "./pedido";
import type {
  Diferenca,
  Ficha,
  Insumo,
  ItemCardapio,
  LinhaFicha,
  Movimento,
  UnidadeInsumo,
} from "./tipos";

function numero(n: number, casas = 2): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: casas });
}

/** Quantidade para ler: "3,2 kg", "800 g", "30 L", "300 ml", "12 unidades". */
export function quantidade(unidade: UnidadeInsumo, base: number): string {
  if (unidade === "un")
    return `${numero(base, 0)} ${Math.abs(base) === 1 ? "unidade" : "unidades"}`;
  const grande = Math.abs(base) >= 1000;
  if (unidade === "g") return grande ? `${numero(base / 1000)} kg` : `${numero(base, 0)} g`;
  return grande ? `${numero(base / 1000)} L` : `${numero(base, 0)} ml`;
}

/** Em que unidade se digita a quantidade: quilo, litro ou unidade. */
export function unidadeDoCampo(unidade: UnidadeInsumo): "kg" | "L" | "unidades" {
  return unidade === "g" ? "kg" : unidade === "ml" ? "L" : "unidades";
}

/** "3,5" no campo de kg ou L vira 3500; em unidades, só número inteiro. Inválido vira null. */
export function baseDoCampo(unidade: UnidadeInsumo, texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (unidade === "un") return /^\d+$/.test(limpo) ? Number(limpo) : null;
  if (!/^\d+(\.\d{1,3})?$/.test(limpo)) return null;
  return Math.round(Number(limpo) * 1000);
}

/** O campo mostrando o valor guardado: 3500 g vira "3,5" (kg). */
export function campoDaBase(unidade: UnidadeInsumo, base: number): string {
  const valor = unidade === "un" ? base : base / 1000;
  return String(valor).replace(".", ",");
}

/** Quanto vai numa porção, como na ficha: "120 g", "300 ml", "1 un". */
export function porPorcao(unidade: UnidadeInsumo, base: number): string {
  return `${numero(base, 0)} ${unidade}`;
}

/** Preço do ingrediente como se compra: "R$ 42/kg", "R$ 13,33/L", "R$ 2,60 a unidade". */
export function precoDoInsumo(insumo: Insumo): string | null {
  if (insumo.custo_centavos === null) return null;
  const sufixo = insumo.unidade === "g" ? "/kg" : insumo.unidade === "ml" ? "/L" : " a unidade";
  return preco(insumo.custo_centavos) + sufixo;
}

export type SituacaoInsumo = "zerado" | "tem";

/** Zerado pela conta: pode ser que acabou de verdade, pode ser conta errada. */
export function situacaoDoInsumo(insumo: Insumo): SituacaoInsumo {
  return insumo.saldo <= 0 ? "zerado" : "tem";
}

/** A lista do estoque: zerados primeiro, depois pelo nome. */
export function ordenarInsumos(insumos: Insumo[]): Insumo[] {
  return [...insumos].sort(
    (a, b) =>
      Number(situacaoDoInsumo(a) === "tem") - Number(situacaoDoInsumo(b) === "tem") ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

/** Pratos ativos que levam o ingrediente. */
export function pratosQueUsam(
  insumoId: number,
  fichas: Ficha[],
  itens: ItemCardapio[],
): ItemCardapio[] {
  const ids = new Set(
    fichas.filter((f) => f.linhas.some((l) => l.insumo_id === insumoId)).map((f) => f.item_id),
  );
  return itens.filter((i) => i.ativo && ids.has(i.id));
}

export interface Sugestao {
  insumo: Insumo;
  pratos: ItemCardapio[];
}

/**
 * Ingrediente zerou pela conta e ainda tem prato marcado "tem hoje" que usa: sugere marcar
 * "acabou". O GIRO nunca marca sozinho; quem olha a geladeira decide.
 */
export function sugestoesDeAcabou(
  insumos: Insumo[],
  fichas: Ficha[],
  itens: ItemCardapio[],
): Sugestao[] {
  return insumos
    .filter((i) => i.ativo && situacaoDoInsumo(i) === "zerado")
    .map((insumo) => ({
      insumo,
      pratos: pratosQueUsam(insumo.id, fichas, itens).filter((p) => p.disponivel),
    }))
    .filter((s) => s.pratos.length > 0);
}

/** Arredonda como o servidor (Python): meio centavo vai para o par. */
function arredondarPar(x: number): number {
  const baixo = Math.floor(x);
  if (Math.abs(x - baixo - 0.5) < 1e-9) return baixo % 2 === 0 ? baixo : baixo + 1;
  return Math.round(x);
}

/** Custo de uma porção pela ficha, para mostrar enquanto edita. Sem preço, não dá para dizer. */
export function custoDaFicha(
  linhas: LinhaFicha[],
  insumos: Insumo[],
  outros: number | null,
): number | null {
  if (linhas.length === 0) return null;
  let total = outros ?? 0;
  for (const linha of linhas) {
    const insumo = insumos.find((i) => i.id === linha.insumo_id);
    if (!insumo || insumo.custo_centavos === null) return null;
    total += (linha.quantidade * insumo.custo_centavos) / (insumo.unidade === "un" ? 1 : 1000);
  }
  return arredondarPar(total);
}

/** O que a contagem achou: "Muçarela: 500 g a menos que a conta." */
export function textoDaDiferenca(d: Diferenca): string {
  if (d.diferenca === 0) return `${d.nome}: bateu com a conta.`;
  const quanto = quantidade(d.unidade, Math.abs(d.diferenca));
  return `${d.nome}: ${quanto} a ${d.diferenca < 0 ? "menos" : "mais"} que a conta.`;
}

/** Uma linha do livro, para ler. */
export function textoDoMovimento(m: Movimento): string {
  switch (m.tipo) {
    case "compra":
      return "Chegou compra";
    case "venda":
      return m.prato ? `Pedido: ${m.prato}` : "Vendas da noite";
    case "estorno":
      return m.prato ? `Cancelado antes de sair: ${m.prato}` : "Pedido cancelado";
    case "perda":
      return `Perda: ${m.motivo ?? "sem motivo"}`;
    case "contagem":
      return m.quantidade === 0 ? "Contagem: bateu" : "Contagem: acertou a conta";
  }
}
