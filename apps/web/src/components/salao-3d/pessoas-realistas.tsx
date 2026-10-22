"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

import { useRefazerSombra } from "./contexto-qualidade";
import { MANIFESTO, URLS_CLIENTES } from "./modelos";
import { clicarNaPessoa, type Sentado } from "./pessoas";

/** Respiração: período (s), inclinação do tronco (rad) e quanto o peito sobe (fração). */
const RESPIRACAO = { periodo: 4.2, inclinacao: 0.008, subida: 0.006 };
/** Pelve de quem senta, caso o modelo não traga o ponto (o padrão das poses geradas). */
const PELVE_PADRAO: [number, number, number] = [0, 0.636, 0.12];

/** Um pedaço de uma pose: cada material (corpo, cabeça, cabelo) é uma malha. */
interface Parte {
  geometria: THREE.BufferGeometry;
  material: THREE.Material;
  /** Onde o pedaço fica dentro da pose (a escala e o deslocamento da quantização). */
  base: THREE.Matrix4;
}

interface Pose {
  partes: Parte[];
  pelve: THREE.Vector3;
}

/** Tira de cada .glb as malhas de cada pose, para dividir entre todas as instâncias. */
function separarPoses(modelos: GLTF[]): Map<string, Pose> {
  const poses = new Map<string, Pose>();
  MANIFESTO.clientes.forEach((cliente, i) => {
    const cena = modelos[i]?.scene;
    if (!cena) return;
    cena.updateMatrixWorld(true);
    for (const nome of cliente.poses) {
      const no = cena.children.find((o: THREE.Object3D) => (o.userData.name ?? o.name) === nome);
      if (!no) continue;
      const partes: Parte[] = [];
      no.traverse((o: THREE.Object3D) => {
        const malha = o as THREE.Mesh;
        if (!malha.isMesh) return;
        partes.push({
          geometria: malha.geometry,
          material: malha.material as THREE.Material,
          base: malha.matrixWorld.clone(),
        });
      });
      const p = (no.userData.pelve as [number, number, number] | undefined) ?? PELVE_PADRAO;
      poses.set(`${cliente.id}|${nome}`, {
        partes,
        pelve: new THREE.Vector3(...p),
      });
    }
  });
  return poses;
}

/** Espelho em x: a pose fica do avesso, com o pé cruzado do outro lado. */
const ESPELHO = new THREE.Matrix4().makeScale(-1, 1, 1);
const EIXO_Y = new THREE.Vector3(0, 1, 0);

/**
 * Onde a pessoa fica no salão, antes da pose: a cadeira, o giro e o espelho. No grupo
 * espelhado, o próprio InstancedMesh também é espelhado (escala -1 em x) para o three.js
 * desenhar as faces do lado certo; a conta aqui desfaz esse espelho.
 */
function matrizDaPessoa(s: Sentado): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (s.escolha.espelhar) m.copy(ESPELHO);
  m.multiply(s.cadeira);
  m.multiply(new THREE.Matrix4().makeRotationAxis(EIXO_Y, s.escolha.giro));
  if (s.escolha.espelhar) m.multiply(ESPELHO);
  return m;
}

/**
 * Os clientes sentados com os modelos realistas (Rocketbox, MIT). Cada cliente+pose vira um
 * InstancedMesh por material: a mesma geometria e o mesmo material servem a todas as mesas,
 * e a placa de vídeo desenha todo mundo daquela pose de uma vez.
 */
export default function PessoasRealistas({
  sentados,
  respirar,
  aoAbrir,
}: {
  sentados: Sentado[];
  respirar: boolean;
  aoAbrir: (mesaId: number) => void;
}) {
  // Sem Draco (os arquivos não usam) e com o decodificador meshopt que vem no pacote.
  const modelos = useGLTF(URLS_CLIENTES, false, true) as unknown as GLTF[];
  const poses = useMemo(() => separarPoses(modelos), [modelos]);
  // Quando os modelos chegam no lugar das pessoas simples, a sombra muda junto.
  useRefazerSombra(sentados);

  const grupos = useMemo(() => {
    const porChave = new Map<string, { pose: string; espelhar: boolean; lista: Sentado[] }>();
    for (const s of sentados) {
      const pose = `${s.escolha.cliente}|${s.escolha.pose}`;
      const chave = `${pose}|${s.escolha.espelhar ? "e" : "d"}`;
      const grupo = porChave.get(chave) ?? {
        pose,
        espelhar: s.escolha.espelhar,
        lista: [],
      };
      grupo.lista.push(s);
      porChave.set(chave, grupo);
    }
    return [...porChave.entries()];
  }, [sentados]);

  return (
    <>
      {grupos.map(([chave, grupo]) => {
        const pose = poses.get(grupo.pose);
        if (!pose) return null;
        return (
          <GrupoDePessoas
            // Quantidade nova: outro InstancedMesh (o tamanho dele é fixo).
            key={`${chave}:${grupo.lista.length}`}
            pose={pose}
            espelhar={grupo.espelhar}
            lista={grupo.lista}
            respirar={respirar}
            aoAbrir={aoAbrir}
          />
        );
      })}
    </>
  );
}

const RESPIRO = new THREE.Matrix4();
const TEMP = new THREE.Matrix4();
const ROTACAO = new THREE.Matrix4();
const ESCALA = new THREE.Matrix4();

/** Pessoas com a mesma pose (e o mesmo lado), desenhadas juntas. */
function GrupoDePessoas({
  pose,
  espelhar,
  lista,
  respirar,
  aoAbrir,
}: {
  pose: Pose;
  espelhar: boolean;
  lista: Sentado[];
  respirar: boolean;
  aoAbrir: (mesaId: number) => void;
}) {
  const malhas = useRef<(THREE.InstancedMesh | null)[]>([]);
  const lugares = useMemo(() => lista.map(matrizDaPessoa), [lista]);

  /** Põe cada pessoa no lugar; `t` (segundos) dá a fase da respiração, ou null para parar. */
  function posicionar(t: number | null) {
    const { pelve } = pose;
    lista.forEach((s, i) => {
      if (t === null) {
        RESPIRO.identity();
      } else {
        const onda = Math.sin((t / RESPIRACAO.periodo) * Math.PI * 2 + s.escolha.fase);
        // Em volta da pelve: o tronco inclina e o peito sobe um pouquinho.
        RESPIRO.makeTranslation(pelve.x, pelve.y, pelve.z);
        ROTACAO.makeRotationX(RESPIRACAO.inclinacao * onda);
        ESCALA.makeScale(1, 1 + RESPIRACAO.subida * onda, 1);
        RESPIRO.multiply(ROTACAO).multiply(ESCALA);
        RESPIRO.multiply(TEMP.makeTranslation(-pelve.x, -pelve.y, -pelve.z));
      }
      pose.partes.forEach((parte, j) => {
        const malha = malhas.current[j];
        if (!malha) return;
        TEMP.multiplyMatrices(lugares[i], RESPIRO).multiply(parte.base);
        malha.setMatrixAt(i, TEMP);
      });
    });
    for (const malha of malhas.current) {
      if (!malha) continue;
      malha.instanceMatrix.needsUpdate = true;
    }
  }

  useLayoutEffect(() => {
    posicionar(null);
    for (const malha of malhas.current) {
      malha?.computeBoundingSphere();
      malha?.computeBoundingBox();
    }
  });

  useFrame(({ clock }) => {
    if (respirar) posicionar(clock.elapsedTime);
  });

  return (
    <group scale={espelhar ? [-1, 1, 1] : 1}>
      {pose.partes.map((parte, j) => (
        <instancedMesh
          key={j}
          ref={(m) => {
            malhas.current[j] = m;
          }}
          args={[parte.geometria, parte.material, lista.length]}
          castShadow
          receiveShadow
          onClick={(e) => clicarNaPessoa(e, lista[e.instanceId ?? -1]?.mesaId, aoAbrir)}
        />
      ))}
    </group>
  );
}

// Começa a baixar assim que este pedaço do pacote chega, antes de a cena pedir.
useGLTF.preload(URLS_CLIENTES, false, true);
