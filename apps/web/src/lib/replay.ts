// Replay da noite: refaz o salão minuto a minuto a partir das visitas às mesas (só horários,
// nunca imagem). O resultado tem o mesmo formato do salão ao vivo, então o 3D e a planta
// desenham o replay sem saber que é passado.

import { horaLocal as hora } from "./resultados";
import type { Alerta, EstadoMesa, Mesa, Replay, VisitaReplay } from "./tipos";

const MINUTO = 60_000;
// O garçom aparece "indo atender" um minuto antes de chegar na mesa.
const ANTES_DE_CHEGAR = MINUTO;

interface Visita {
  sentou: number;
  atendida: number | null;
  saiu: number | null;
  liberada: number | null;
  pessoas: number;
  semAtendimento: boolean;
}

function emMs(v: VisitaReplay): Visita {
  const ms = (iso: string | null) => (iso === null ? null : Date.parse(iso));
  return {
    sentou: Date.parse(v.sentou_em),
    atendida: ms(v.atendida_em),
    saiu: ms(v.saiu_em),
    liberada: ms(v.liberada_em),
    pessoas: v.pessoas,
    semAtendimento: v.sem_atendimento,
  };
}

/** Até quando a mesa ficou indisponível (sem saída registrada: até o fim do replay). */
function fimDaVisita(v: Visita): number {
  return v.liberada ?? v.saiu ?? Number.POSITIVE_INFINITY;
}

function visitasPorMesa(replay: Replay): Map<number, Visita[]> {
  const porMesa = new Map<number, Visita[]>();
  for (const v of replay.visitas) {
    const lista = porMesa.get(v.mesa_id) ?? [];
    lista.push(emMs(v));
    porMesa.set(v.mesa_id, lista);
  }
  for (const lista of porMesa.values()) lista.sort((a, b) => a.sentou - b.sentou);
  return porMesa;
}

export interface LinhaDoTempo {
  inicioMs: number;
  fimMs: number;
}

/** Do primeiro cliente (com 10 min de folga) até a última mesa liberada, sem passar de agora. */
export function linhaDoTempo(replay: Replay): LinhaDoTempo | null {
  if (replay.visitas.length === 0) return null;
  const visitas = replay.visitas.map(emMs);
  const limite = Date.parse(replay.fim);
  const primeira = Math.min(...visitas.map((v) => v.sentou));
  const ultima = Math.max(...visitas.map((v) => Math.min(fimDaVisita(v), limite)));
  const inicioMs = Math.floor((primeira - 10 * MINUTO) / MINUTO) * MINUTO;
  return { inicioMs, fimMs: Math.min(ultima + 10 * MINUTO, limite) };
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/** O salão como estava no instante `t`: mesas no formato do ao vivo e os alertas abertos. */
export function salaoNoInstante(replay: Replay, t: number): { mesas: Mesa[]; alertas: Alerta[] } {
  const porMesa = visitasPorMesa(replay);
  const mesas: Mesa[] = [];
  const alertas: Alerta[] = [];
  const limiteMs = replay.limite_alerta_seg * 1000;

  for (const info of replay.mesas) {
    const visitas = porMesa.get(info.id) ?? [];
    const atual = visitas.find((v) => v.sentou <= t && t < fimDaVisita(v));
    const anterior = visitas.filter((v) => fimDaVisita(v) <= t).at(-1);

    let estado: EstadoMesa = "livre";
    let desde: number | null = anterior ? fimDaVisita(anterior) : null;
    if (atual) {
      if (atual.semAtendimento || atual.atendida === null || t < atual.atendida) {
        estado = "aguardando";
        desde = atual.sentou;
      } else if (atual.saiu === null || t < atual.saiu) {
        estado = "ocupada";
        desde = atual.atendida;
      } else {
        estado = "para_limpar";
        desde = atual.saiu;
      }
    }

    mesas.push({
      id: info.id,
      numero: info.numero,
      lugares: info.lugares,
      pos_x: info.pos_x,
      pos_y: info.pos_y,
      ativa: true,
      estado,
      estado_desde: iso(desde),
      camera_id: null,
      poligono: null,
      sentou_em: atual ? iso(atual.sentou) : null,
      atendida_em:
        atual && atual.atendida !== null && atual.atendida <= t ? iso(atual.atendida) : null,
      saiu_em: atual && atual.saiu !== null && atual.saiu <= t ? iso(atual.saiu) : null,
      pessoas: atual && estado !== "para_limpar" ? atual.pessoas : 0,
    });

    if (atual && estado === "aguardando" && t - atual.sentou >= limiteMs) {
      const criado = atual.sentou + limiteMs;
      const indo = atual.atendida !== null ? atual.atendida - ANTES_DE_CHEGAR : null;
      alertas.push({
        id: info.id * 1_000_000 + (Math.floor(atual.sentou / MINUTO) % 1_000_000),
        tipo: "sem_atendimento",
        mesa_id: info.id,
        mesa_numero: info.numero,
        criado_em: new Date(criado).toISOString(),
        reconhecido_em: indo !== null && indo >= criado && indo <= t ? iso(indo) : null,
        resolvido_em: null,
      });
    }
  }
  return { mesas, alertas };
}

/** Abaixo disso a mesa andou bem: fica sem mancha, para a atenção ir às que travaram. */
export const CALOR_MINIMO = 0.12;

/** Uma visita que foi embora sem atendimento conta como 15 min de mesa travada. */
const PESO_DESISTENCIA_MIN = 15;

export interface TravaDaMesa {
  mesaId: number;
  numero: number;
  minutosSuja: number;
  foramEmbora: number;
  /** De 0 a 1, relativo à pior mesa da noite. */
  calor: number;
}

/** Onde o salão travou: mesa parada suja e gente indo embora, da pior mesa para a melhor. */
export function travasPorMesa(replay: Replay): TravaDaMesa[] {
  const numero = new Map(replay.mesas.map((m) => [m.id, m.numero]));
  const travas: (TravaDaMesa & { pontos: number })[] = [];
  for (const [mesaId, visitas] of visitasPorMesa(replay)) {
    const n = numero.get(mesaId);
    if (n === undefined) continue;
    let minutosSuja = 0;
    let foramEmbora = 0;
    for (const v of visitas) {
      if (v.semAtendimento) foramEmbora += 1;
      else if (v.saiu !== null && v.liberada !== null)
        minutosSuja += (v.liberada - v.saiu) / MINUTO;
    }
    const pontos = minutosSuja + PESO_DESISTENCIA_MIN * foramEmbora;
    travas.push({ mesaId, numero: n, minutosSuja, foramEmbora, calor: 0, pontos });
  }
  const maior = Math.max(0, ...travas.map((t) => t.pontos));
  return travas
    .map(({ pontos, ...t }) => ({ ...t, calor: maior > 0 ? pontos / maior : 0 }))
    .sort((a, b) => b.calor - a.calor || a.numero - b.numero);
}

/** O mapa de calor em si: mesa → 0 a 1. */
export function calorPorMesa(replay: Replay): Map<number, number> {
  return new Map(travasPorMesa(replay).map((t) => [t.mesaId, t.calor]));
}

/** O que aconteceu numa mesa durante a noite, visita por visita, em frases curtas. */
export function linhaDaMesa(replay: Replay, mesaId: number): string[] {
  const visitas = visitasPorMesa(replay).get(mesaId) ?? [];
  return visitas.map((v) => {
    const quem = `${v.pessoas} ${v.pessoas === 1 ? "pessoa" : "pessoas"}`;
    if (v.semAtendimento) {
      return `${hora(v.sentou)}: ${quem} sentaram e foram embora sem atendimento${v.saiu !== null ? ` às ${hora(v.saiu)}` : ""}.`;
    }
    const partes = [`${hora(v.sentou)}: ${quem}`];
    if (v.atendida !== null)
      partes.push(`atendidas em ${Math.round((v.atendida - v.sentou) / MINUTO)} min`);
    if (v.saiu !== null) partes.push(`saíram às ${hora(v.saiu)}`);
    if (v.saiu !== null && v.liberada !== null) {
      partes.push(`mesa liberada ${Math.round((v.liberada - v.saiu) / MINUTO)} min depois`);
    }
    return `${partes.join(", ")}.`;
  });
}

export interface Momento {
  ms: number;
  mesaNumero: number;
  texto: string;
  gravidade: number; // minutos de prejuízo, para escolher os mais importantes
}

/** Os momentos que valem rever: quem foi embora, mesa muito tempo suja, espera longa. */
export function momentosDaNoite(replay: Replay, maximo = 6): Momento[] {
  const numero = new Map(replay.mesas.map((m) => [m.id, m.numero]));
  const limite = replay.limite_alerta_seg * 1000;
  const momentos: Momento[] = [];
  for (const [mesaId, visitas] of visitasPorMesa(replay)) {
    const n = numero.get(mesaId);
    if (n === undefined) continue;
    for (const v of visitas) {
      if (v.semAtendimento && v.saiu !== null) {
        momentos.push({
          ms: v.saiu,
          mesaNumero: n,
          texto: `Mesa ${n}: foram embora sem atendimento`,
          gravidade: PESO_DESISTENCIA_MIN + v.pessoas,
        });
        continue;
      }
      if (v.saiu !== null && v.liberada !== null) {
        const parada = (v.liberada - v.saiu) / MINUTO;
        if (parada >= 10) {
          momentos.push({
            ms: v.saiu,
            mesaNumero: n,
            texto: `Mesa ${n}: ficou ${Math.round(parada)} min suja`,
            gravidade: parada,
          });
        }
      }
      if (v.atendida !== null && v.atendida - v.sentou > limite) {
        const espera = (v.atendida - v.sentou) / MINUTO;
        momentos.push({
          ms: v.sentou + limite,
          mesaNumero: n,
          texto: `Mesa ${n}: esperou ${Math.round(espera)} min pelo atendimento`,
          gravidade: espera,
        });
      }
    }
  }
  return momentos
    .sort((a, b) => b.gravidade - a.gravidade)
    .slice(0, maximo)
    .sort((a, b) => a.ms - b.ms);
}
