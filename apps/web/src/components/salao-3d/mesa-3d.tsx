"use client";

import { Line } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { memo, useMemo, useRef, useState } from "react";
import type * as THREE from "three";

import type { Tom } from "@/lib/salao";

import { aparencia, roupaDe } from "./aparencia";
import { useQualidade, useRefazerSombra } from "./contexto-qualidade";
import type { CoresDoSalao, CoresNaCena } from "./cores";
import {
  ALTURA_TOALHA,
  formaTapete,
  geometriaCadeira,
  geometriaCardapio,
  geometriaComida,
  geometriaCopo,
  geometriaGuardanapo,
  geometriaLiquido,
  geometriaMesa,
  geometriaPrato,
} from "./geometrias";
import { Garcom, PessoaSentada } from "./pessoas";
import { type Assento, lugarNaMesa, type MesaNoSalao } from "./planta";

const FOLGA_TAPETE = 0.2;

interface Props {
  item: MesaNoSalao;
  tom: Tom;
  sentados: number;
  comGarcom: boolean;
  verComoCamera: boolean;
  movimentoReduzido: boolean;
  /** Tokens do painel (texto), para o contorno da câmera nas pessoas. */
  cores: CoresDoSalao;
  /** As mesmas cores prontas para o 3D (pré-corrigidas quando há efeitos). */
  coresTela: CoresNaCena;
  aoAbrir: (mesaId: number) => void;
}

/** Uma mesa no salão: móveis, o que está em cima dela, quem está sentado e o tapete do estado. */
function Mesa3D({
  item,
  tom,
  sentados,
  comGarcom,
  verComoCamera,
  movimentoReduzido,
  cores,
  coresTela,
  aoAbrir,
}: Props) {
  const [apontada, setApontada] = useState(false);
  const { animar, sombras } = useQualidade();
  const a = aparencia();
  const mesa = geometriaMesa(item.forma);
  const cadeira = geometriaCadeira();
  // A sombra só se refaz quando algo que faz sombra muda nesta mesa.
  useRefazerSombra(`${item.x}:${item.z}:${item.mesa.lugares}:${tom}:${sentados}:${comGarcom}`);

  function clicar(evento: ThreeEvent<MouseEvent>) {
    evento.stopPropagation();
    if (evento.delta < 6) aoAbrir(item.mesa.id); // arrastar para girar o salão não abre a mesa
  }

  return (
    <group position={[item.x, 0, item.z]}>
      <group
        onClick={clicar}
        onPointerOver={(e) => {
          e.stopPropagation();
          setApontada(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setApontada(false);
          document.body.style.cursor = "";
        }}
      >
        <mesh geometry={mesa.tampo} material={a.tampo} castShadow receiveShadow />
        <mesh geometry={mesa.toalha} material={a.toalha} castShadow receiveShadow />
        <mesh geometry={mesa.pes} material={a.metal} castShadow />
        {item.assentos.map((assento, i) => (
          <group
            key={`${assento.x}:${assento.z}`}
            position={[assento.x, 0, assento.z]}
            rotation-y={assento.rotacao}
          >
            <mesh geometry={cadeira} material={a.madeiraEscura} castShadow receiveShadow />
            {i < sentados && (
              <PessoaSentada
                roupa={roupaDe(a, item.mesa.numero, i)}
                verComoCamera={verComoCamera}
              />
            )}
          </group>
        ))}
        <SobreAMesa
          assentos={item.assentos}
          tom={tom}
          sentados={sentados}
          numero={item.mesa.numero}
        />
      </group>

      {comGarcom && (
        <group position={[item.meiaPegada.x + 0.32, 0, 0.18]} rotation-y={-Math.PI / 2}>
          <Garcom verComoCamera={verComoCamera} corContorno={cores.aguardando} />
        </group>
      )}

      {sombras === "nenhuma" && (
        <SombraDeContato meiaX={item.meiaPegada.x} meiaZ={item.meiaPegada.z} />
      )}

      <Tapete
        meiaX={item.meiaPegada.x + FOLGA_TAPETE}
        meiaZ={item.meiaPegada.z + FOLGA_TAPETE}
        tom={tom}
        cor={coresTela[tom]}
        destacado={apontada}
        parado={movimentoReduzido || !animar}
      />
    </group>
  );
}

/** Só redesenha a mesa quando algo que aparece nela muda (o cronômetro fica no rótulo). */
export const MesaNoSalao3D = memo(
  Mesa3D,
  (antes, depois) =>
    antes.item.mesa.id === depois.item.mesa.id &&
    antes.item.mesa.lugares === depois.item.mesa.lugares &&
    antes.item.x === depois.item.x &&
    antes.item.z === depois.item.z &&
    antes.tom === depois.tom &&
    antes.sentados === depois.sentados &&
    antes.comGarcom === depois.comGarcom &&
    antes.verComoCamera === depois.verComoCamera &&
    antes.movimentoReduzido === depois.movimentoReduzido &&
    antes.cores === depois.cores &&
    antes.coresTela === depois.coresTela &&
    antes.aoAbrir === depois.aoAbrir,
);

/**
 * O que está em cima da mesa conta a história do estado: mesa posta (livre), cardápio
 * (esperando atendimento), prato servido (ocupada) e louça suja (para limpar).
 */
function SobreAMesa({
  assentos,
  tom,
  sentados,
  numero,
}: {
  assentos: Assento[];
  tom: Tom;
  sentados: number;
  numero: number;
}) {
  const a = aparencia();
  const usados = tom === "limpar" ? Math.max(2, Math.ceil(assentos.length / 2)) : sentados;

  return (
    <group position-y={ALTURA_TOALHA}>
      {assentos.map((assento, i) => {
        const lugar = lugarNaMesa(assento);
        const copo = lugarNaMesa({ ...assento, rotacao: assento.rotacao - 0.4 }, 0.6);
        const ocupado = i < usados;
        // Louça suja fica torta e fora do lugar; sorteio fixo pelo número da mesa.
        const torto = tom === "limpar" && ocupado ? (((numero * 7 + i * 13) % 10) - 5) * 0.012 : 0;
        return (
          <group key={`${assento.x}:${assento.z}`}>
            {(tom === "aguardando" || tom === "atrasada") && ocupado ? (
              <mesh
                geometry={geometriaCardapio()}
                material={a.cardapio}
                position={[lugar.x, 0, lugar.z]}
                rotation-y={assento.rotacao + 0.15}
                castShadow
              />
            ) : (
              <mesh
                geometry={geometriaPrato()}
                material={a.louca}
                position={[lugar.x + torto, 0, lugar.z - torto]}
                receiveShadow
              />
            )}
            {tom === "ocupada" && ocupado && (
              <>
                <mesh
                  geometry={geometriaComida()}
                  material={a.massa}
                  position={[lugar.x, 0.012, lugar.z]}
                />
                <mesh
                  geometry={geometriaComida()}
                  material={a.molho}
                  position={[lugar.x + 0.01, 0.022, lugar.z]}
                  scale={0.5}
                />
              </>
            )}
            {tom === "limpar" && ocupado && (
              <>
                <mesh
                  geometry={geometriaComida()}
                  material={a.molho}
                  position={[lugar.x + torto, 0.006, lugar.z]}
                  scale={[0.6, 0.15, 0.4]}
                />
                <mesh
                  geometry={geometriaGuardanapo()}
                  material={a.guardanapo}
                  position={[copo.x - 0.12, 0.02, copo.z + 0.05]}
                  rotation-y={i}
                  castShadow
                />
              </>
            )}
            <mesh geometry={geometriaCopo()} material={a.vidro} position={[copo.x, 0, copo.z]} />
            {ocupado && tom !== "limpar" && (
              <mesh
                geometry={geometriaLiquido()}
                material={tom === "ocupada" ? a.vinho : a.agua}
                position={[copo.x, 0, copo.z]}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Sem sombra projetada (nível baixo), uma mancha escura e macia no chão debaixo da mesa e
 * das cadeiras faz o papel da sombra. Custa um quadrado transparente.
 */
function SombraDeContato({ meiaX, meiaZ }: { meiaX: number; meiaZ: number }) {
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position-y={0.003}
      scale={[meiaX * 2 + 0.3, meiaZ * 2 + 0.3, 1]}
      material={aparencia().sombraContato}
      renderOrder={0}
    >
      <planeGeometry />
    </mesh>
  );
}

/**
 * Tapete do estado no chão, com cor e padrão: livre só tem contorno tracejado (quieta),
 * para limpar é listrada e a mesa atrasada pulsa, como na planta. Parado (movimento
 * reduzido ou aparelho fraco), a atrasada ganha um halo fixo em vez do pulso.
 */
function Tapete({
  meiaX,
  meiaZ,
  tom,
  cor,
  destacado,
  parado,
}: {
  meiaX: number;
  meiaZ: number;
  tom: Tom;
  cor: THREE.Color;
  destacado: boolean;
  parado: boolean;
}) {
  const forma = useMemo(() => formaTapete(meiaX, meiaZ), [meiaX, meiaZ]);
  const contorno = useMemo(
    () => forma.getPoints(8).map((p) => [p.x, 0.014, -p.y] as [number, number, number]),
    [forma],
  );
  const preenchimento = useRef<THREE.MeshBasicMaterial>(null);
  const pulso = useRef<THREE.Mesh>(null);
  const atrasada = tom === "atrasada";
  const base = tom === "livre" ? 0 : destacado ? 0.55 : 0.34;

  useFrame(({ clock }) => {
    if (!atrasada || parado) return;
    const fase = (clock.elapsedTime % 1.6) / 1.6;
    if (preenchimento.current) {
      preenchimento.current.opacity = base + 0.18 * Math.sin(fase * Math.PI * 2);
    }
    if (pulso.current) {
      pulso.current.scale.setScalar(1 + fase * 0.22);
      (pulso.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - fase);
    }
  });

  return (
    <group>
      {tom !== "livre" && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.006} receiveShadow renderOrder={1}>
          <shapeGeometry args={[forma, 6]} />
          <meshBasicMaterial
            ref={preenchimento}
            color={cor}
            map={tom === "limpar" ? aparencia().listras : null}
            transparent
            opacity={base}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
      <Line
        points={contorno}
        color={cor}
        lineWidth={destacado ? 3.2 : 2.2}
        dashed={tom === "livre"}
        dashSize={0.16}
        gapSize={0.1}
        transparent
        opacity={0.95}
        toneMapped={false}
      />
      {atrasada && (
        <mesh
          ref={pulso}
          rotation-x={-Math.PI / 2}
          position-y={0.008}
          scale={parado ? 1.1 : 1}
          renderOrder={2}
        >
          <shapeGeometry args={[forma, 6]} />
          <meshBasicMaterial
            color={cor}
            transparent
            opacity={parado ? 0.3 : 0.5}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}
