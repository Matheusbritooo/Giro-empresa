// Endereço da API. Vazio = mesmo domínio do painel (produção atrás do Caddy).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export class ErroApi extends Error {
  constructor(
    public status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export async function api<T>(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown; restaurante?: number | null } = {},
): Promise<T> {
  const url = new URL(API_URL + caminho, window.location.origin);
  if (opcoes.restaurante) url.searchParams.set("restaurante_id", String(opcoes.restaurante));

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: opcoes.metodo ?? "GET",
      credentials: "include",
      headers: opcoes.corpo === undefined ? undefined : { "content-type": "application/json" },
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
    });
  } catch {
    throw new ErroApi(0, "Sem conexão com o servidor. Confira a internet e tente de novo.");
  }

  if (resposta.status === 204) return undefined as T;
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw new ErroApi(resposta.status, mensagemDeErro(dados, resposta.status));
  return dados as T;
}

function mensagemDeErro(dados: unknown, status: number): string {
  const detalhe = (dados as { detail?: unknown } | null)?.detail;
  if (typeof detalhe === "string") return detalhe;
  if (Array.isArray(detalhe) && detalhe[0]?.msg) {
    const campo = detalhe[0].loc?.at(-1);
    return campo ? `${campo}: ${detalhe[0].msg}` : detalhe[0].msg;
  }
  return `O servidor respondeu com erro ${status}.`;
}

export function urlAoVivo(restaurante: number | null): string {
  const base = new URL(API_URL || window.location.origin, window.location.origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/api/ao-vivo";
  if (restaurante) base.searchParams.set("restaurante_id", String(restaurante));
  return base.toString();
}
