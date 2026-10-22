"use client";

import { memo, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { aparencia } from "./aparencia";

export const ALTURA_PAREDE = 3;
const ESPESSURA = 0.16;
const LAMBRI = 1.05;
const TABUA_METROS = 2.4; // cada repetição da textura do piso cobre 2,4 m

/**
 * A cantina em volta das mesas: piso de tábua, duas paredes (fundo e esquerda, como uma
 * maquete aberta para quem olha), janelas para a rua à noite, balcão com garrafas, plantas,
 * arandelas e o nome do restaurante em letreiro.
 */
export const Sala = memo(function Sala({
  largura,
  profundidade,
  nome,
}: {
  largura: number;
  profundidade: number;
  nome: string;
}) {
  const a = aparencia();
  const fundo = -profundidade / 2;
  const esquerda = -largura / 2;
  const janelas = posicoesJanelas(largura);

  return (
    <group>
      <Piso largura={largura} profundidade={profundidade} />

      {/* Parede do fundo e parede da esquerda, com lambri verde e friso de madeira. */}
      <mesh
        position={[0, ALTURA_PAREDE / 2, fundo - ESPESSURA / 2]}
        material={a.reboco}
        receiveShadow
      >
        <boxGeometry args={[largura + ESPESSURA * 2, ALTURA_PAREDE, ESPESSURA]} />
      </mesh>
      <mesh
        position={[esquerda - ESPESSURA / 2, ALTURA_PAREDE / 2, 0]}
        material={a.reboco}
        receiveShadow
      >
        <boxGeometry args={[ESPESSURA, ALTURA_PAREDE, profundidade]} />
      </mesh>
      <mesh position={[0, LAMBRI / 2, fundo + 0.02]} material={a.lambri} receiveShadow>
        <boxGeometry args={[largura, LAMBRI, 0.04]} />
      </mesh>
      <mesh position={[esquerda + 0.02, LAMBRI / 2, 0]} material={a.lambri} receiveShadow>
        <boxGeometry args={[0.04, LAMBRI, profundidade]} />
      </mesh>
      <mesh position={[0, LAMBRI + 0.025, fundo + 0.035]} material={a.friso}>
        <boxGeometry args={[largura, 0.05, 0.07]} />
      </mesh>
      <mesh position={[esquerda + 0.035, LAMBRI + 0.025, 0]} material={a.friso}>
        <boxGeometry args={[0.07, 0.05, profundidade]} />
      </mesh>

      {janelas.map((x) => (
        <Janela key={x} x={x} z={fundo} />
      ))}
      {janelas.slice(0, -1).map((x, i) => (
        <Arandela key={x} posicao={[(x + janelas[i + 1]) / 2, 2.25, fundo + 0.08]} />
      ))}

      <Letreiro nome={nome} posicao={[0, 2.05, fundo + 0.03]} />
      <Balcao x={esquerda} z={fundo + 1.1} comprimento={Math.min(3.4, profundidade * 0.4)} />
      <Planta posicao={[largura / 2 - 0.65, 0, fundo + 0.65]} semente={1} />
      <Planta posicao={[esquerda + 0.65, 0, profundidade / 2 - 0.7]} semente={2} />
    </group>
  );
});

/** Janelas no fundo, deixando o meio livre para o letreiro. */
function posicoesJanelas(largura: number): number[] {
  const lado = Math.max(1, Math.min(2, Math.floor((largura - 4.4) / 4)));
  const passo = (largura / 2 - 2.6) / lado;
  const xs: number[] = [];
  for (let i = 1; i <= lado; i++) xs.push(-(2.6 + passo * (i - 0.5)), 2.6 + passo * (i - 0.5));
  return xs.sort((p, q) => p - q);
}

function Piso({ largura, profundidade }: { largura: number; profundidade: number }) {
  const geometria = useMemo(() => {
    const g = new THREE.PlaneGeometry(largura, profundidade);
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        (uv.getX(i) * largura) / TABUA_METROS,
        (uv.getY(i) * profundidade) / TABUA_METROS,
      );
    }
    return g;
  }, [largura, profundidade]);
  useEffect(() => () => geometria.dispose(), [geometria]);

  return (
    <mesh
      geometry={geometria}
      material={aparencia().piso}
      rotation-x={-Math.PI / 2}
      receiveShadow
    />
  );
}

function Janela({ x, z }: { x: number; z: number }) {
  const a = aparencia();
  return (
    <group position={[x, 1.88, z]}>
      <mesh position-z={0.04} material={a.friso} castShadow>
        <boxGeometry args={[1.36, 1.5, 0.08]} />
      </mesh>
      <mesh position-z={0.085} material={a.noite}>
        <boxGeometry args={[1.2, 1.34, 0.02]} />
      </mesh>
      <mesh position-z={0.1} material={a.friso}>
        <boxGeometry args={[0.05, 1.34, 0.03]} />
      </mesh>
      <mesh position={[0, 0.1, 0.1]} material={a.friso}>
        <boxGeometry args={[1.2, 0.05, 0.03]} />
      </mesh>
      <mesh position={[0, -0.78, 0.1]} material={a.friso} castShadow>
        <boxGeometry args={[1.5, 0.05, 0.2]} />
      </mesh>
    </group>
  );
}

function Arandela({ posicao }: { posicao: [number, number, number] }) {
  const a = aparencia();
  return (
    <group position={posicao}>
      <mesh material={a.metal} position-z={0.02}>
        <cylinderGeometry args={[0.07, 0.07, 0.04, 20]} />
      </mesh>
      <mesh material={a.luzQuente} position-z={0.09} rotation-x={Math.PI / 2}>
        <sphereGeometry args={[0.09, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <pointLight color="#ffc983" intensity={2.4} distance={6.5} decay={1.6} position-z={0.35} />
    </group>
  );
}

function geometriaGarrafa(): THREE.BufferGeometry {
  const corpo = new THREE.CylinderGeometry(0.036, 0.036, 0.22, 16).translate(0, 0.11, 0);
  const ombro = new THREE.CylinderGeometry(0.014, 0.036, 0.05, 16).translate(0, 0.245, 0);
  const gargalo = new THREE.CylinderGeometry(0.013, 0.013, 0.08, 12).translate(0, 0.31, 0);
  const junta = mergeGeometries([corpo, ombro, gargalo]) as THREE.BufferGeometry;
  for (const g of [corpo, ombro, gargalo]) g.dispose();
  return junta;
}

function Balcao({ x, z, comprimento }: { x: number; z: number; comprimento: number }) {
  const a = aparencia();
  const garrafa = useMemo(() => geometriaGarrafa(), []);
  useEffect(() => () => garrafa.dispose(), [garrafa]);
  const fundo = 0.6;
  const centroZ = z + comprimento / 2;
  const banquetas = [0.2, 0.5, 0.8].map((t) => z + comprimento * t);
  const porPrateleira = Math.floor((comprimento - 0.3) / 0.22);

  return (
    <group>
      <mesh
        position={[x + fundo / 2 + 0.05, 0.52, centroZ]}
        material={a.madeiraEscura}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[fundo, 1.04, comprimento]} />
      </mesh>
      <mesh
        position={[x + fundo / 2 + 0.07, 1.065, centroZ]}
        material={a.pedra}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[fundo + 0.1, 0.05, comprimento + 0.08]} />
      </mesh>
      {banquetas.map((bz) => (
        <group key={bz} position={[x + fundo + 0.45, 0, bz]}>
          <mesh position-y={0.75} material={a.madeiraEscura} castShadow>
            <cylinderGeometry args={[0.19, 0.17, 0.06, 24]} />
          </mesh>
          <mesh position-y={0.37} material={a.metal} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 0.72, 10]} />
          </mesh>
          <mesh position-y={0.015} material={a.metal}>
            <cylinderGeometry args={[0.2, 0.2, 0.03, 24]} />
          </mesh>
        </group>
      ))}
      {[1.5, 1.95].map((y, prateleira) => (
        <group key={y}>
          <mesh position={[x + 0.14, y, centroZ]} material={a.friso} castShadow>
            <boxGeometry args={[0.26, 0.035, comprimento]} />
          </mesh>
          {Array.from({ length: porPrateleira }, (_, i) => (
            <mesh
              key={i}
              geometry={garrafa}
              material={(i + prateleira) % 3 === 0 ? a.garrafaAmbar : a.garrafaVerde}
              position={[x + 0.14, y + 0.018, z + 0.2 + i * 0.22]}
              castShadow
            />
          ))}
        </group>
      ))}
    </group>
  );
}

function Planta({ posicao, semente }: { posicao: [number, number, number]; semente: number }) {
  const a = aparencia();
  // Tufos de folhas em volta do tronco, em posições fixas (não mudam a cada tela).
  const tufos = Array.from({ length: 7 }, (_, i) => {
    const angulo = i * 2.4 + semente;
    const raio = i === 0 ? 0 : 0.16 + (i % 3) * 0.05;
    return {
      x: Math.cos(angulo) * raio,
      y: 0.85 + i * 0.11,
      z: Math.sin(angulo) * raio,
      r: 0.24 - i * 0.015,
    };
  });
  return (
    <group position={posicao}>
      <mesh position-y={0.25} material={a.terracota} castShadow receiveShadow>
        <cylinderGeometry args={[0.27, 0.2, 0.5, 28]} />
      </mesh>
      {tufos.map((t) => (
        <mesh key={`${t.x}:${t.y}`} position={[t.x, t.y, t.z]} material={a.folhas} castShadow>
          <icosahedronGeometry args={[t.r, 1]} />
        </mesh>
      ))}
    </group>
  );
}

/** Nome do restaurante em letreiro de luz, desenhado com a fonte do painel. */
function Letreiro({ nome, posicao }: { nome: string; posicao: [number, number, number] }) {
  const [textura, setTextura] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    let vivo = true;
    const fonte = '800 150px "Big Shoulders Display Variable"';
    document.fonts
      .load(fonte)
      .catch(() => [])
      .then(() => {
        if (vivo) setTextura(desenharLetreiro(nome, fonte));
      });
    return () => {
      vivo = false;
    };
  }, [nome]);
  useEffect(() => () => textura?.dispose(), [textura]);

  if (!textura) return null;
  const proporcao = textura.image.width / textura.image.height;
  const altura = 0.8;
  return (
    <mesh position={posicao}>
      <planeGeometry args={[altura * proporcao, altura]} />
      <meshBasicMaterial map={textura} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function desenharLetreiro(nome: string, fonte: string): THREE.CanvasTexture {
  const tela = document.createElement("canvas");
  const pincel = tela.getContext("2d") as CanvasRenderingContext2D;
  pincel.font = fonte;
  const largura = Math.ceil(pincel.measureText(nome).width) + 120;
  tela.width = Math.min(2048, largura);
  tela.height = 240;
  pincel.font = fonte; // mudar o tamanho da tela apaga a fonte escolhida
  pincel.textAlign = "center";
  pincel.textBaseline = "middle";
  // Duas passadas: o brilho do néon e depois a letra.
  pincel.shadowColor = "#ffae4a";
  pincel.shadowBlur = 36;
  pincel.fillStyle = "#ffcf8f";
  pincel.fillText(nome, tela.width / 2, tela.height / 2 + 6);
  pincel.shadowBlur = 8;
  pincel.fillStyle = "#fff3de";
  pincel.fillText(nome, tela.width / 2, tela.height / 2 + 6);
  const textura = new THREE.CanvasTexture(tela);
  textura.colorSpace = THREE.SRGBColorSpace;
  return textura;
}
