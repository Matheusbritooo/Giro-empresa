"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect } from "react";
import * as THREE from "three";

import { enquadrarMesa } from "./camera-mesa";
import type { PlantaSalao } from "./planta";

/** Duração da ida da câmera até a mesa (ms). */
export const DURACAO_VOO_MS = 1200;

/** Pedido para levar a câmera até uma mesa. `vez` muda a cada clique, mesmo na mesma mesa. */
export interface PedidoDeFoco {
  mesaId: number;
  vez: number;
}

export interface Voo {
  dePosicao: THREE.Vector3;
  deAlvo: THREE.Vector3;
  paraPosicao: THREE.Vector3;
  paraAlvo: THREE.Vector3;
  inicio: number;
  duracao: number;
  numero: number;
}

/** Controles de órbita, do jeito que esta peça usa. */
interface Orbita extends THREE.EventDispatcher<{ start: object }> {
  target: THREE.Vector3;
  update: () => void;
}

/** Começa e termina devagar, sem tranco. */
function suave(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Leva a câmera até a mesa pedida (pelo botão "Ver no salão" do alerta) em ~1,2 s. Com
 * movimento reduzido, pula direto. Se a pessoa arrastar o salão no meio, o voo para ali.
 */
export function VooDaCamera({
  planta,
  pedido,
  movimentoReduzido,
  vooRef,
  aoChegar,
}: {
  planta: PlantaSalao;
  pedido: PedidoDeFoco | null;
  movimentoReduzido: boolean;
  /** Fica com quem desenha a página, para "Voltar à vista inicial" cancelar o voo. */
  vooRef: RefObject<Voo | null>;
  aoChegar: (numeroMesa: number) => void;
}) {
  const camera = useThree((s) => s.camera);
  const controles = useThree((s) => s.controls) as unknown as Orbita | null;
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!pedido || !controles) return;
    const item = planta.mesas.find((m) => m.mesa.id === pedido.mesaId);
    if (!item) return;
    const { posicao, alvo } = enquadrarMesa(item, planta);
    vooRef.current = {
      dePosicao: camera.position.clone(),
      deAlvo: controles.target.clone(),
      paraPosicao: new THREE.Vector3(...posicao),
      paraAlvo: new THREE.Vector3(...alvo),
      inicio: performance.now(),
      duracao: movimentoReduzido ? 0 : DURACAO_VOO_MS,
      numero: item.mesa.numero,
    };
    invalidate();
    // Só um pedido novo (ou os controles ficando prontos) dispara o voo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido, controles]);

  useEffect(() => {
    if (!controles) return;
    const cancelar = () => {
      vooRef.current = null;
    };
    controles.addEventListener("start", cancelar);
    return () => controles.removeEventListener("start", cancelar);
  }, [controles, vooRef]);

  useFrame(() => {
    const v = vooRef.current;
    if (!v || !controles) return;
    const t = v.duracao > 0 ? Math.min(1, (performance.now() - v.inicio) / v.duracao) : 1;
    const k = suave(t);
    camera.position.lerpVectors(v.dePosicao, v.paraPosicao, k);
    controles.target.lerpVectors(v.deAlvo, v.paraAlvo, k);
    controles.update();
    if (t >= 1) {
      vooRef.current = null;
      aoChegar(v.numero);
    } else {
      invalidate(); // no Canvas sob demanda, pede o próximo quadro do voo
    }
  });

  return null;
}
