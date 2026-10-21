import type { Alerta, EstadoMesa, Mesa, MensagemAoVivo, Salao } from "./tipos";

export type Tom = "livre" | "aguardando" | "atrasada" | "ocupada" | "limpar";

export interface EstadoSalao {
  salao: Salao | null;
  // Diferença entre o relógio do servidor e o do aparelho, para os cronômetros não mentirem.
  ajusteRelogioMs: number;
}

export const SALAO_VAZIO: EstadoSalao = { salao: null, ajusteRelogioMs: 0 };

export function aplicarMensagem(
  estado: EstadoSalao,
  mensagem: MensagemAoVivo,
  agoraLocalMs: number = Date.now(),
): EstadoSalao {
  if (mensagem.tipo === "salao") {
    return {
      salao: mensagem.salao,
      ajusteRelogioMs: Date.parse(mensagem.salao.agora) - agoraLocalMs,
    };
  }
  if (!estado.salao) return estado;
  const salao = estado.salao;

  if (mensagem.tipo === "mesa") {
    const existe = salao.mesas.some((m) => m.id === mensagem.mesa.id);
    const mesas = existe
      ? salao.mesas.map((m) => (m.id === mensagem.mesa.id ? mensagem.mesa : m))
      : [...salao.mesas, mensagem.mesa].sort((a, b) => a.numero - b.numero);
    return { ...estado, salao: { ...salao, mesas: mesas.filter((m) => m.ativa) } };
  }

  const alerta = mensagem.alerta;
  const outros = salao.alertas.filter((a) => a.id !== alerta.id);
  const alertas = alerta.resolvido_em ? outros : [...outros, alerta];
  alertas.sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em));
  return { ...estado, salao: { ...salao, alertas } };
}

/** "4:07" até uma hora, depois "1h05". */
export function tempoDecorrido(desde: string, agoraMs: number): string {
  const segundos = Math.max(0, Math.floor((agoraMs - Date.parse(desde)) / 1000));
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos}:${String(segundos % 60).padStart(2, "0")}`;
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

export function minutosEntre(de: string, ate: string | number): number {
  const fim = typeof ate === "number" ? ate : Date.parse(ate);
  return Math.max(0, Math.round((fim - Date.parse(de)) / 60000));
}

export function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const ROTULOS: Record<EstadoMesa, string> = {
  livre: "Livre",
  aguardando: "Aguardando",
  ocupada: "Ocupada",
  para_limpar: "Para limpar",
};

export interface Situacao {
  tom: Tom;
  rotulo: string;
  curto: string; // cabe dentro da mesa no mapa do celular
  desde: string | null; // de onde conta o cronômetro
  descricao: string; // frase completa, para leitor de tela e detalhe
}

export function situacao(mesa: Mesa, agoraMs: number, limiteSeg: number): Situacao {
  switch (mesa.estado) {
    case "aguardando": {
      const desde = mesa.sentou_em ?? mesa.estado_desde;
      const atrasada = desde !== null && agoraMs - Date.parse(desde) >= limiteSeg * 1000;
      return {
        tom: atrasada ? "atrasada" : "aguardando",
        rotulo: atrasada ? "Sem atendimento" : ROTULOS.aguardando,
        curto: atrasada ? "Atrasada" : "Esperando",
        desde,
        descricao: `Mesa ${mesa.numero}: ${pessoas(mesa.pessoas)} esperando atendimento`,
      };
    }
    case "ocupada":
      return {
        tom: "ocupada",
        rotulo: ROTULOS.ocupada,
        curto: "Ocupada",
        desde: mesa.sentou_em ?? mesa.estado_desde,
        descricao: `Mesa ${mesa.numero}: ocupada, ${pessoas(mesa.pessoas)}`,
      };
    case "para_limpar":
      return {
        tom: "limpar",
        rotulo: ROTULOS.para_limpar,
        curto: "Limpar",
        desde: mesa.saiu_em ?? mesa.estado_desde,
        descricao: `Mesa ${mesa.numero}: clientes saíram, falta limpar`,
      };
    default:
      return {
        tom: "livre",
        rotulo: ROTULOS.livre,
        curto: "Livre",
        desde: null,
        descricao: `Mesa ${mesa.numero}: livre, ${mesa.lugares} lugares`,
      };
  }
}

function pessoas(n: number): string {
  return n === 1 ? "1 pessoa" : `${n} pessoas`;
}

export function contarPorTom(mesas: Mesa[], agoraMs: number, limiteSeg: number) {
  const contagem: Record<Tom, number> = {
    livre: 0,
    aguardando: 0,
    atrasada: 0,
    ocupada: 0,
    limpar: 0,
  };
  for (const mesa of mesas) contagem[situacao(mesa, agoraMs, limiteSeg).tom] += 1;
  return contagem;
}

export function textoAlerta(alerta: Alerta): string {
  return alerta.tipo === "sem_atendimento"
    ? `Mesa ${alerta.mesa_numero} está sem atendimento`
    : `Mesa ${alerta.mesa_numero} vagou e precisa ser limpa`;
}
