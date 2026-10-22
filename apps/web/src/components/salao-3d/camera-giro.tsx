"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { aparencia } from "./aparencia";

/**
 * A câmera de segurança que o restaurante já tem, no canto do fundo, com o campo de visão
 * desenhado até o chão. No modo "como a câmera vê", o campo acende e uma linha varre o salão.
 */
export const CameraDoSalao = memo(function CameraDoSalao({
  posicao,
  area,
  cor,
  verComoCamera,
  movimentoReduzido,
}: {
  posicao: [number, number, number];
  /** Metade do retângulo do chão que a câmera enxerga, centrado na origem. */
  area: { x: number; z: number };
  cor: string;
  verComoCamera: boolean;
  movimentoReduzido: boolean;
}) {
  const a = aparencia();
  const corpo = useRef<THREE.Group>(null);
  const led = useRef<THREE.MeshBasicMaterial>(null);
  const varredura = useRef<THREE.Mesh>(null);

  useLayoutEffect(() => {
    corpo.current?.lookAt(0, 0, 0);
  }, [posicao]);

  const { cone, arestas } = useMemo(() => {
    const [px, py, pz] = posicao;
    const cantos = [
      [-area.x, 0.02, -area.z],
      [area.x, 0.02, -area.z],
      [area.x, 0.02, area.z],
      [-area.x, 0.02, area.z],
    ];
    const lados: number[] = [];
    const linhas: number[] = [];
    for (let i = 0; i < 4; i++) {
      const c = cantos[i];
      const d = cantos[(i + 1) % 4];
      lados.push(px, py, pz, ...c, ...d);
      linhas.push(px, py, pz, ...c, ...c, ...d);
    }
    const cone = new THREE.BufferGeometry();
    cone.setAttribute("position", new THREE.Float32BufferAttribute(lados, 3));
    const arestas = new THREE.BufferGeometry();
    arestas.setAttribute("position", new THREE.Float32BufferAttribute(linhas, 3));
    return { cone, arestas };
  }, [posicao, area.x, area.z]);
  useEffect(
    () => () => {
      cone.dispose();
      arestas.dispose();
    },
    [cone, arestas],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (led.current) led.current.opacity = movimentoReduzido || t % 1.2 < 0.75 ? 1 : 0.15;
    if (varredura.current) {
      const fase = (t % 3.2) / 3.2;
      varredura.current.position.z = -area.z + fase * area.z * 2;
    }
  });

  return (
    <group>
      <group position={posicao}>
        {/* Suporte preso na parede do fundo. */}
        <mesh position={[0, 0.1, -0.2]} material={a.metal}>
          <boxGeometry args={[0.07, 0.07, 0.42]} />
        </mesh>
        <group ref={corpo}>
          <mesh material={a.avental} castShadow>
            <boxGeometry args={[0.15, 0.14, 0.32]} />
          </mesh>
          <mesh position-z={0.18} rotation-x={Math.PI / 2} material={a.metal}>
            <cylinderGeometry args={[0.055, 0.06, 0.06, 24]} />
          </mesh>
          <mesh position={[0.045, 0.045, 0.165]}>
            <sphereGeometry args={[0.012, 10, 8]} />
            <meshBasicMaterial ref={led} color="#ff3b30" transparent toneMapped={false} />
          </mesh>
        </group>
      </group>

      <mesh geometry={cone} renderOrder={3}>
        <meshBasicMaterial
          color={cor}
          transparent
          opacity={verComoCamera ? 0.1 : 0.035}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={arestas} renderOrder={4}>
        <lineBasicMaterial
          color={cor}
          transparent
          opacity={verComoCamera ? 0.85 : 0.28}
          toneMapped={false}
        />
      </lineSegments>

      {verComoCamera && !movimentoReduzido && (
        <mesh ref={varredura} rotation-x={-Math.PI / 2} position-y={0.03} renderOrder={5}>
          <planeGeometry args={[area.x * 2, 0.08]} />
          <meshBasicMaterial
            color={cor}
            transparent
            opacity={0.7}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
});
