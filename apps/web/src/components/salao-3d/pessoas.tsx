"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { lazy, Suspense, useMemo } from "react";
import * as THREE from "three";

import { LimiteDeErro } from "@/components/limite-de-erro";
import type { Mesa } from "@/lib/tipos";

import { aparencia, roupaDe } from "./aparencia";
import { useQualidade, useRefazerSombra } from "./contexto-qualidade";
import { corNaCena } from "./cores";
import { escolherPessoas, type PessoaEscolhida } from "./escolha-pessoas";
import { contornoPessoa, geometriaSentada } from "./geometrias";
import { MANIFESTO } from "./modelos";
import type { PlantaSalao } from "./planta";

// Os modelos de gente (e o leitor de .glb) só chegam quando o 3D abre.
const PessoasRealistas = lazy(() => import("./pessoas-realistas"));

/** Uma pessoa sentada numa cadeira do salão. */
export interface Sentado {
  mesaId: number;
  /** Mesa e assento, para a cor da roupa da pessoa simples. */
  numero: number;
  assento: number;
  /** Onde fica a cadeira no salão (posição e rotação), sem a pose da pessoa. */
  cadeira: THREE.Matrix4;
  escolha: PessoaEscolhida;
}

/** Quantos a câmera viu sentados numa mesa que está esperando ou ocupada. */
export function pessoasSentadas(mesa: Mesa): number {
  if (mesa.estado !== "aguardando" && mesa.estado !== "ocupada") return 0;
  return Math.min(Math.max(mesa.pessoas, 1), mesa.lugares);
}

const EIXO_Y = new THREE.Vector3(0, 1, 0);

/** Todas as pessoas sentadas no salão, com quem é cada uma (sempre a mesma na mesma visita). */
export function montarSentados(planta: PlantaSalao): Sentado[] {
  const saida: Sentado[] = [];
  for (const item of planta.mesas) {
    const escolhas = escolherPessoas(
      item,
      pessoasSentadas(item.mesa),
      item.mesa.sentou_em,
      MANIFESTO.clientes,
    );
    escolhas.forEach((escolha, i) => {
      const a = item.assentos[i];
      const cadeira = new THREE.Matrix4().compose(
        new THREE.Vector3(item.x + a.x, 0, item.z + a.z),
        new THREE.Quaternion().setFromAxisAngle(EIXO_Y, a.rotacao),
        new THREE.Vector3(1, 1, 1),
      );
      saida.push({
        mesaId: item.mesa.id,
        numero: item.mesa.numero,
        assento: i,
        cadeira,
        escolha,
      });
    });
  }
  return saida;
}

/** Contorno que a câmera desenha: branco para quem está sentado, amarelo para quem está em pé. */
export function Contorno({ emPe, cor }: { emPe: boolean; cor: THREE.ColorRepresentation }) {
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

export interface PropsPessoas {
  planta: PlantaSalao;
  verComoCamera: boolean;
  /** Respiração sutil (só no nível alto, sem movimento reduzido). */
  respirar: boolean;
  aoAbrir: (mesaId: number) => void;
}

/**
 * Os clientes sentados. Enquanto os modelos realistas baixam, ficam as pessoas simples (sem
 * rosto), para o salão aparecer na hora. No modo "Ver como a câmera", cada uma ganha o
 * contorno branco de quem a câmera conta sentado.
 */
export function PessoasNoSalao({ planta, verComoCamera, respirar, aoAbrir }: PropsPessoas) {
  const sentados = useMemo(() => montarSentados(planta), [planta]);
  const { efeitos } = useQualidade();
  // Branco do contorno pré-corrigido para o tom dos efeitos, como as cores dos estados.
  const branco = useMemo(() => corNaCena("#ffffff", efeitos), [efeitos]);
  const chave = sentados
    .map((s) => `${s.mesaId}.${s.assento}.${s.escolha.cliente}.${s.escolha.pose}`)
    .join("|");
  // Gente nova ou que foi embora muda a sombra do salão.
  useRefazerSombra(chave);

  return (
    <>
      {/* Se o pedaço do pacote com os modelos não chegar, fica todo mundo no desenho simples. */}
      <LimiteDeErro reserva={<PessoasSimples sentados={sentados} aoAbrir={aoAbrir} />}>
        <Suspense fallback={<PessoasSimples sentados={sentados} aoAbrir={aoAbrir} />}>
          <PessoasRealistas sentados={sentados} respirar={respirar} aoAbrir={aoAbrir} />
        </Suspense>
      </LimiteDeErro>
      {verComoCamera &&
        sentados.map((s) => (
          <group key={`${s.mesaId}:${s.assento}`} matrixAutoUpdate={false} matrix={s.cadeira}>
            <Contorno emPe={false} cor={branco} />
          </group>
        ))}
    </>
  );
}

/** Tocar numa pessoa abre a mesa dela (arrastar para girar o salão não abre). */
export function clicarNaPessoa(
  evento: ThreeEvent<MouseEvent>,
  mesaId: number | undefined,
  aoAbrir: (mesaId: number) => void,
) {
  evento.stopPropagation();
  if (mesaId !== undefined && evento.delta < 6) aoAbrir(mesaId);
}

/** Pessoas simples, sem rosto: a reserva enquanto os modelos realistas não chegam. */
export function PessoasSimples({
  sentados,
  aoAbrir,
}: {
  sentados: Sentado[];
  aoAbrir: (mesaId: number) => void;
}) {
  const g = geometriaSentada();
  const a = aparencia();
  return (
    <>
      {sentados.map((s) => (
        <group
          key={`${s.mesaId}:${s.assento}`}
          matrixAutoUpdate={false}
          matrix={s.cadeira}
          onClick={(e) => clicarNaPessoa(e, s.mesaId, aoAbrir)}
        >
          <mesh
            geometry={g.roupa}
            material={roupaDe(a, s.numero, s.assento)}
            castShadow
            receiveShadow
          />
          <mesh geometry={g.pele} material={a.argila} castShadow />
        </group>
      ))}
    </>
  );
}
