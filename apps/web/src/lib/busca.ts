// A busca de qualquer tela: mesas, pratos, ingredientes e as próprias telas do painel, sem
// acento e sem diferença de maiúscula (testada em busca.test.ts).

import { quantidade } from "./estoque";
import { preco } from "./pedido";
import { podeGerirEquipe, podeGerirMesas } from "./sessao";
import type { Cardapio, Insumo, Mesa, Papel } from "./tipos";

export type TipoResultado = "tela" | "mesa" | "prato" | "ingrediente";

export interface Resultado {
  tipo: TipoResultado;
  titulo: string;
  detalhe: string;
  href: string;
}

export interface Fontes {
  mesas: Mesa[];
  cardapio: Cardapio | null;
  insumos: Insumo[];
}

interface Tela {
  titulo: string;
  href: string;
  palavras: string;
  quem: (papel: Papel) => boolean;
}

const todos = () => true;
const soDono = (papel: Papel) => papel === "dono" || papel === "admin_giro";

const TELAS: Tela[] = [
  { titulo: "Hoje", href: "/hoje", palavras: "resumo dia pendencias", quem: podeGerirMesas },
  { titulo: "Salão", href: "/salao", palavras: "mapa mesas alertas ao vivo 3d", quem: todos },
  { titulo: "Cozinha", href: "/cozinha", palavras: "fila pedidos pronto tv", quem: todos },
  {
    titulo: "Estoque",
    href: "/estoque",
    palavras: "ingredientes compra perda contagem",
    quem: todos,
  },
  {
    titulo: "Lista de compras",
    href: "/estoque?aba=lista",
    palavras: "comprar fornecedor whatsapp",
    quem: podeGerirMesas,
  },
  {
    titulo: "Perdas do estoque",
    href: "/estoque?aba=perdas",
    palavras: "cmv curva abc escapou preco subiu",
    quem: soDono,
  },
  {
    titulo: "Fichas dos pratos",
    href: "/estoque?aba=fichas",
    palavras: "ficha tecnica receita",
    quem: todos,
  },
  {
    titulo: "Resultados",
    href: "/resultados",
    palavras: "giro dinheiro ficou na mesa copiloto e se replay",
    quem: podeGerirMesas,
  },
  {
    titulo: "Relatório do mês",
    href: "/resultados/relatorio",
    palavras: "pdf planilha contador mensal",
    quem: podeGerirMesas,
  },
  { titulo: "Cardápio", href: "/cardapio", palavras: "itens precos acabou matriz", quem: todos },
  { titulo: "Mesas", href: "/mesas", palavras: "cadastrar mesas lugares", quem: podeGerirMesas },
  {
    titulo: "QR das mesas",
    href: "/mesas/qr",
    palavras: "qr code imprimir cliente",
    quem: podeGerirMesas,
  },
  {
    titulo: "Câmeras",
    href: "/cameras",
    palavras: "camera desenhar mesas calibrar",
    quem: podeGerirMesas,
  },
  {
    titulo: "Equipe",
    href: "/equipe",
    palavras: "usuarios garcom gerente senha",
    quem: podeGerirEquipe,
  },
  {
    titulo: "Quem fez o quê",
    href: "/historico",
    palavras: "historico mudou preco quem mexeu cancelou auditoria",
    quem: podeGerirEquipe,
  },
  {
    titulo: "Ajustes",
    href: "/ajustes",
    palavras: "configuracoes ticket horario alerta dias de compra folga",
    quem: podeGerirEquipe,
  },
];

const ESTADO: Record<Mesa["estado"], string> = {
  livre: "Livre",
  aguardando: "Esperando atendimento",
  ocupada: "Ocupada",
  para_limpar: "Para limpar",
};

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** 0 = começa com o termo, 1 = alguma palavra começa com ele, 2 = contém, null = não serve. */
function pontos(texto: string, termo: string): number | null {
  const t = normalizar(texto);
  if (t.startsWith(termo)) return 0;
  if (t.split(/\s+/).some((p) => p.startsWith(termo))) return 1;
  return t.includes(termo) ? 2 : null;
}

/** "mesa 7", "m7" e "7" acham a mesa 7. */
function numeroDaMesa(termo: string): number | null {
  const m = /^(?:mesa\s*|m\s*)?(\d{1,3})$/.exec(termo);
  return m ? Number(m[1]) : null;
}

export function buscar(texto: string, fontes: Fontes, papel: Papel, limite = 8): Resultado[] {
  const termo = normalizar(texto);
  if (!termo) return [];
  const achados: { r: Resultado; p: number; ordem: number }[] = [];
  const achar = (r: Resultado, p: number | null, ordem: number) => {
    if (p !== null) achados.push({ r, p, ordem });
  };

  const numero = numeroDaMesa(termo);
  for (const mesa of fontes.mesas) {
    const exata = numero !== null && mesa.numero === numero;
    const p = exata ? -1 : numero === null ? pontos(`mesa ${mesa.numero}`, termo) : null;
    achar(
      {
        tipo: "mesa",
        titulo: `Mesa ${mesa.numero}`,
        detalhe: `${ESTADO[mesa.estado]}, ${mesa.lugares} lugares`,
        href: `/pedido?mesa=${mesa.id}`,
      },
      p,
      0,
    );
  }

  const categorias = new Map((fontes.cardapio?.categorias ?? []).map((c) => [c.id, c]));
  for (const item of fontes.cardapio?.itens ?? []) {
    if (!item.ativo) continue;
    achar(
      {
        tipo: "prato",
        titulo: item.nome,
        detalhe: `${categorias.get(item.categoria_id)?.nome ?? "Cardápio"}, ${
          item.disponivel ? preco(item.preco_centavos) : "acabou hoje"
        }`,
        href: "/cardapio",
      },
      pontos(item.nome, termo),
      1,
    );
  }

  for (const insumo of fontes.insumos) {
    if (!insumo.ativo) continue;
    achar(
      {
        tipo: "ingrediente",
        titulo: insumo.nome,
        detalhe:
          insumo.saldo > 0
            ? `Estoque, tem ${quantidade(insumo.unidade, insumo.saldo)}`
            : "Estoque, zerado pela conta",
        href: "/estoque",
      },
      pontos(insumo.nome, termo),
      2,
    );
  }

  for (const tela of TELAS) {
    if (!tela.quem(papel)) continue;
    const p = pontos(tela.titulo, termo) ?? (pontos(tela.palavras, termo) === null ? null : 3);
    achar({ tipo: "tela", titulo: tela.titulo, detalhe: "Tela do painel", href: tela.href }, p, 3);
  }

  return achados
    .sort((a, b) => a.p - b.p || a.ordem - b.ordem || a.r.titulo.localeCompare(b.r.titulo, "pt-BR"))
    .slice(0, limite)
    .map((a) => a.r);
}

/** Junta o restaurante da equipe GIRO no link, quando tem. */
export function comRestauranteNoLink(href: string, restaurante: string | null): string {
  if (!restaurante) return href;
  return `${href}${href.includes("?") ? "&" : "?"}restaurante=${restaurante}`;
}
