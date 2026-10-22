"use client";

import type * as THREE from "three";

import { aparencia } from "./aparencia";
import { contornoPessoa, geometriaGarcom, geometriaSentada } from "./geometrias";

/** Contorno que a câmera desenha: branco para quem está sentado, amarelo para quem está em pé. */
export function Contorno({ emPe, cor }: { emPe: boolean; cor: string }) {
  return (
    <lineSegments geometry={contornoPessoa(emPe)} renderOrder={10}>
      <lineBasicMaterial
        color={cor}
        transparent
        opacity={0.95}
        depthTest={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

export function PessoaSentada({
  roupa,
  verComoCamera,
}: {
  roupa: THREE.Material;
  verComoCamera: boolean;
}) {
  const g = geometriaSentada();
  return (
    <group>
      <mesh geometry={g.roupa} material={roupa} castShadow receiveShadow />
      <mesh geometry={g.pele} material={aparencia().argila} castShadow />
      {verComoCamera && <Contorno emPe={false} cor="#ffffff" />}
    </group>
  );
}

export function Garcom({
  verComoCamera,
  corContorno,
}: {
  verComoCamera: boolean;
  corContorno: string;
}) {
  const g = geometriaGarcom();
  const a = aparencia();
  return (
    <group>
      <mesh geometry={g.roupa} material={a.colete} castShadow />
      <mesh geometry={g.pele} material={a.argila} castShadow />
      <mesh geometry={g.avental} material={a.avental} castShadow />
      <mesh geometry={g.bandeja} material={a.metal} castShadow />
      {verComoCamera && <Contorno emPe cor={corContorno} />}
    </group>
  );
}
