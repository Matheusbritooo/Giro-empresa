"use client";

import { useGLTF } from "@react-three/drei";
import { type ReactNode, Suspense, useMemo } from "react";
import * as THREE from "three";

import { LimiteDeErro } from "@/components/limite-de-erro";

import { useRefazerSombra } from "./contexto-qualidade";
import { MANIFESTO, urlDoModelo } from "./modelos";

export type IdDecoracao = "planta" | "vaso-flores" | "geladeira";

/**
 * Vidro com "transmission" faz o three desenhar a cena inteira mais uma vez por quadro só
 * para ele. Aqui vira transparência simples: a porta da geladeira e o vaso continuam de vidro.
 */
function vidroSimples(material: THREE.Material): THREE.Material {
  if (!(material instanceof THREE.MeshPhysicalMaterial) || material.transmission === 0) {
    return material;
  }
  const vidro = material.clone();
  vidro.transmission = 0;
  vidro.thickness = 0;
  vidro.transparent = true;
  vidro.opacity = 0.28;
  vidro.depthWrite = false;
  return vidro;
}

/** Um modelo do manifesto, apoiado no chão e com o tamanho escolhido (altura em metros). */
function Modelo({
  id,
  altura,
  posicao,
  giro,
}: {
  id: IdDecoracao;
  altura: number;
  posicao: [number, number, number];
  giro: number;
}) {
  const item = MANIFESTO.decoracao.find((d) => d.id === id);
  if (!item) throw new Error(`Decoração ${id} fora do manifesto`);
  const { scene } = useGLTF(urlDoModelo(item.arquivo), false, true);

  const objeto = useMemo(() => {
    // A cópia divide malhas e materiais com o original: duas plantas custam o mesmo que uma.
    const copia = scene.clone(true);
    copia.updateMatrixWorld(true);
    const caixa = new THREE.Box3().setFromObject(copia);
    const tamanho = caixa.getSize(new THREE.Vector3());
    const centro = caixa.getCenter(new THREE.Vector3());
    const escala = altura / tamanho.y;
    copia.scale.setScalar(escala);
    copia.position.set(-centro.x * escala, -caixa.min.y * escala, -centro.z * escala);
    copia.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.material = Array.isArray(o.material)
        ? o.material.map(vidroSimples)
        : vidroSimples(o.material);
    });
    return copia;
  }, [scene, altura]);
  useRefazerSombra(objeto);

  return (
    <group position={posicao} rotation-y={giro}>
      <primitive object={objeto} />
    </group>
  );
}

/**
 * Peça de decoração feita a partir de um modelo de verdade (Khronos, em `public/modelos`).
 * Enquanto baixa, ou se não baixar, fica a `reserva` (a versão desenhada no código, ou nada).
 */
export function Decoracao({
  reserva = null,
  giro = 0,
  ...modelo
}: {
  id: IdDecoracao;
  altura: number;
  posicao: [number, number, number];
  giro?: number;
  reserva?: ReactNode;
}) {
  return (
    <LimiteDeErro reserva={reserva}>
      <Suspense fallback={reserva}>
        <Modelo {...modelo} giro={giro} />
      </Suspense>
    </LimiteDeErro>
  );
}
