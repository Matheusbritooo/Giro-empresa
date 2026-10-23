"use client";

import { useMemo } from "react";
import type * as THREE from "three";

import { CALOR_MINIMO } from "@/lib/replay";

import { formaTapete } from "./geometrias";
import type { MesaNoSalao, PlantaSalao } from "./planta";

/** Quanto a mancha passa do tapete da mesa: 5 cm na mesa mais tranquila, 50 cm na pior. */
const ALEM_DO_TAPETE: [number, number] = [0.25, 0.7];

/**
 * Mapa de calor do replay: uma mancha no chão em volta de cada mesa, maior e mais forte onde
 * o salão travou (mesa suja muito tempo, gente indo embora). Fica abaixo do tapete do estado,
 * então a cor da mesa continua valendo.
 */
export function ManchasDeCalor({
  planta,
  calor,
  cor,
}: {
  planta: PlantaSalao;
  calor: ReadonlyMap<number, number>;
  cor: THREE.Color;
}) {
  return planta.mesas.map((item) => {
    const valor = calor.get(item.mesa.id) ?? 0;
    return valor >= CALOR_MINIMO ? (
      <Mancha key={item.mesa.id} item={item} valor={valor} cor={cor} />
    ) : null;
  });
}

function Mancha({ item, valor, cor }: { item: MesaNoSalao; valor: number; cor: THREE.Color }) {
  const alem = ALEM_DO_TAPETE[0] + (ALEM_DO_TAPETE[1] - ALEM_DO_TAPETE[0]) * valor;
  const meiaX = item.meiaPegada.x + alem;
  const meiaZ = item.meiaPegada.z + alem;
  const forma = useMemo(() => formaTapete(meiaX, meiaZ, 0.6), [meiaX, meiaZ]);
  return (
    <mesh position={[item.x, 0.004, item.z]} rotation-x={-Math.PI / 2} renderOrder={0}>
      <shapeGeometry args={[forma, 6]} />
      <meshBasicMaterial
        color={cor}
        transparent
        opacity={0.05 + 0.45 * valor}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
