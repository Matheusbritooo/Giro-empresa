// Contas da tela "Hoje", sem tela nenhuma (testadas em hoje.test.ts). O que muda de segundo
// em segundo vem do canal ao vivo; o resto (cozinha, estoque, perdas) o servidor manda pronto.

import { camerasSemSinal, contarPorTom, tempoDecorrido, textoAlerta } from "./salao";
import type { Pendencia, Salao } from "./tipos";

/** O salão agora, em quatro números. */
export function resumoDoSalao(salao: Salao, agoraMs: number) {
  const tons = contarPorTom(salao.mesas, agoraMs, salao.restaurante.alerta_atendimento_seg);
  return {
    mesas: salao.mesas.length,
    ocupadas: tons.ocupada,
    esperando: tons.aguardando + tons.atrasada,
    semAtendimento: tons.atrasada,
    paraLimpar: tons.limpar,
  };
}

/** O que o salão está pedindo neste instante: alertas abertos e câmera sem sinal. */
export function pendenciasAoVivo(salao: Salao, agoraMs: number): Pendencia[] {
  const alertas = salao.alertas.map((alerta) => ({
    tipo: "alerta",
    texto: `${textoAlerta(alerta)}, há ${tempoDecorrido(alerta.criado_em, agoraMs)}.`,
    href: "/salao",
    urgente: alerta.tipo === "sem_atendimento",
  }));
  const cameras = camerasSemSinal(salao.cameras, agoraMs).map((camera) => ({
    tipo: "camera",
    texto: `A câmera ${camera.nome} está sem sinal. Sem ela, o salão para de se atualizar.`,
    href: "/cameras",
    urgente: true,
  }));
  return [...alertas, ...cameras];
}

/** Tudo numa lista só: o urgente primeiro, e dentro de cada grupo o salão antes do resto. */
export function juntarPendencias(aoVivo: Pendencia[], doServidor: Pendencia[]): Pendencia[] {
  const todas = [...aoVivo, ...doServidor];
  return [...todas.filter((p) => p.urgente), ...todas.filter((p) => !p.urgente)];
}

const IR_PARA: Record<string, string> = {
  alerta: "Ver no salão",
  camera: "Abrir as câmeras",
  cozinha: "Abrir a cozinha",
  compra: "Ver a lista de compras",
  preco: "Ver as perdas",
  perdas: "Ver as perdas",
  acabou: "Abrir o cardápio",
};

/** O texto do link de cada pendência: diz para onde leva. */
export function irPara(tipo: string): string {
  return IR_PARA[tipo] ?? "Abrir o estoque";
}

/** "/estoque?aba=perdas" com o restaurante da equipe GIRO junto, quando tem. */
export function comRestaurante(href: string, restaurante: string | null): string {
  if (!restaurante) return href;
  return `${href}${href.includes("?") ? "&" : "?"}restaurante=${restaurante}`;
}

/** "Costuma fechar com 27", comparando com as noites iguais das últimas semanas. */
export function textoDoCostume(costuma: { noites: number; mesas_atendidas: number } | null) {
  return costuma
    ? `costuma fechar com ${costuma.mesas_atendidas}`
    : "ainda sem noites para comparar";
}
