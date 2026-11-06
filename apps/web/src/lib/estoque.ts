// Contas da tela de estoque, sem tela nenhuma (testadas em estoque.test.ts).
// Quantidade sempre na unidade base do ingrediente: grama, mililitro ou unidade.

import { preco } from "./pedido";
import { noiteDe } from "./resultados";
import type {
  Diferenca,
  Ficha,
  Insumo,
  ItemCardapio,
  LinhaDeCompra,
  LinhaDePerda,
  LinhaFicha,
  ListaDeCompras,
  Movimento,
  SituacaoInsumo,
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

/** Pela previsão do servidor; sem ela (fora de uso), só zerado ou tem. */
export function situacaoDoInsumo(insumo: Insumo): SituacaoInsumo {
  return insumo.situacao ?? (insumo.saldo <= 0 ? "zerado" : "tem");
}

export const ROTULO_SITUACAO: Record<SituacaoInsumo, string> = {
  zerado: "Zerado",
  vai_faltar: "Vai faltar",
  comprar: "Comprar",
  tem: "Tem",
};

const ORDEM: Record<SituacaoInsumo, number> = { zerado: 0, vai_faltar: 0, comprar: 1, tem: 2 };

/** A lista do estoque: o urgente primeiro, depois o que entra na compra, depois o resto. */
export function ordenarInsumos(insumos: Insumo[]): Insumo[] {
  return [...insumos].sort(
    (a, b) =>
      ORDEM[situacaoDoInsumo(a)] - ORDEM[situacaoDoInsumo(b)] ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

/** "hoje", "amanhã", "na quinta", "no sábado". */
export function quando(dia: string, hoje: string): string {
  const n = diasEntre(hoje, dia);
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return `${semana === 0 || semana === 6 ? "no" : "na"} ${DIAS_SEMANA[semana]}`;
}

/** Até quando dá, para a tabela: "acaba amanhã", "dá a semana toda". */
export function textoAteQuando(insumo: Insumo, hoje: string): string {
  if (insumo.acaba_em) return `acaba ${quando(insumo.acaba_em, hoje)}`;
  return insumo.saldo <= 0 ? "não tem" : "dá a semana toda";
}

/** Plural da primeira palavra: "pacote de 1 kg" vira "pacotes de 1 kg"; "barril", "barris". */
export function plural(nome: string): string {
  const [primeira, ...resto] = nome.split(" ");
  let p = primeira;
  if (p.endsWith("il")) p = `${p.slice(0, -2)}is`;
  else if (/[rz]$/.test(p)) p = `${p}es`;
  else if (p.endsWith("m")) p = `${p.slice(0, -1)}ns`;
  else if (!p.endsWith("s")) p = `${p}s`;
  return [p, ...resto].join(" ");
}

/** O que pedir ao fornecedor: "8 pacotes de 1 kg", "1 barril de 30 L" ou "7 kg". */
export function textoCompra(
  unidade: UnidadeInsumo,
  embalagens: number,
  embalagemQuantidade: number,
  embalagemNome: string | null,
): string {
  const nome = embalagemNome?.trim() ?? "";
  if (!nome || ["kg", "l", "g", "ml", "un"].includes(nome.toLowerCase()))
    return quantidade(unidade, embalagens * embalagemQuantidade);
  return `${embalagens} ${embalagens === 1 ? nome : plural(nome)}`;
}

/** A lista para colar no WhatsApp do fornecedor: por onde se compra, sem preço. */
export function textoDaLista(lista: ListaDeCompras, restaurante: string): string {
  const grupos = new Map<string, LinhaDeCompra[]>();
  for (const linha of lista.comprar) {
    const onde = linha.onde_compra ?? "Outros";
    grupos.set(onde, [...(grupos.get(onde) ?? []), linha]);
  }
  const dia = DIAS_SEMANA[new Date(`${lista.compra}T12:00:00Z`).getUTCDay()];
  let texto = `Compras de ${dia} (${restaurante})\n`;
  for (const [onde, linhas] of grupos) {
    texto += `\n${onde}\n`;
    for (const l of linhas)
      texto += `- ${l.nome}: ${textoCompra(l.unidade, l.embalagens, l.embalagem_quantidade, l.embalagem_nome)}\n`;
  }
  return texto;
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
    case "inicial":
      return "Já tinha quando entrou no estoque";
  }
}

/** "28,3%" */
export function porcento(fracao: number): string {
  return `${(fracao * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Os da curva A sem contagem há mais de uma semana: a contagem deles mostra onde o dinheiro escapa. */
export function precisaContar(insumo: Insumo, hoje: string): boolean {
  if (insumo.curva !== "A" || !insumo.ativo) return false;
  if (!insumo.contado_em) return true;
  const contado = noiteDe(Date.parse(insumo.contado_em));
  return (Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${contado}T12:00:00Z`)) / 86_400_000 > 7;
}

/** O que olhar primeiro num ingrediente que escapou. */
export function dicaDaPerda(linha: LinhaDePerda): string {
  const sumiu = quantidade(linha.unidade, linha.sem_registro);
  if (linha.sem_registro > linha.registrada) {
    const porcao =
      linha.prato && linha.por_porcao
        ? ` A ficha diz ${porPorcao(linha.unidade, linha.por_porcao)} por ${linha.prato.toLowerCase()}: confira a porção na bancada.`
        : " Confira a porção e se a contagem está certa.";
    return `${linha.nome}: ${sumiu} sumiram sem registro.${porcao}`;
  }
  return `${linha.nome}: a maior parte foi registrada como perda. Veja o motivo e compre menos de cada vez.`;
}
