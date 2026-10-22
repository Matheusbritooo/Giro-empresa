"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Suspense, use } from "react";

import { LimiteDeErro } from "@/components/limite-de-erro";

/** Quanto a luz refletida do ambiente pesa: pouco, para não lavar a noite da cantina. */
const INTENSIDADE = 0.3;

let hdri: Promise<string | null> | null = null;

/**
 * Foto 360° de um saguão de luz quente (Poly Haven, CC0, empacotada em @pmndrs/assets).
 * Comparada com a "hall" na mesma vista: dão quase a mesma imagem, e a "lobby" puxa um
 * pouco mais para o quente da cantina.
 * Vem por import dinâmico: vira um pedaço separado do pacote, baixado só quando o 3D abre e
 * servido pelo próprio painel (nada de CDN, como faria o `preset` do drei).
 */
function carregarHdri(): Promise<string | null> {
  // Sem o arquivo, fica só a luz desenhada abaixo.
  hdri ??= import("@pmndrs/assets/hdri/lobby.exr").then((m) => m.default).catch(() => null);
  return hdri;
}

/** Luz de teto quente e o azul da rua pelas janelas, somados à foto 360°. */
function Recortes() {
  return (
    <>
      <Lightformer
        form="rect"
        intensity={4}
        color="#ffdcae"
        scale={[14, 14, 1]}
        position={[0, 7, 0]}
        rotation-x={Math.PI / 2}
      />
      <Lightformer
        form="rect"
        intensity={1.4}
        color="#8fa8d0"
        scale={[10, 3, 1]}
        position={[0, 2, -9]}
      />
    </>
  );
}

function ComFoto() {
  const arquivo = use(carregarHdri());
  return (
    <Environment files={arquivo ?? undefined} resolution={256} environmentIntensity={INTENSIDADE}>
      <Recortes />
    </Environment>
  );
}

/** Só os recortes de luz, sem foto (mesma resolução da versão com foto: não recompila). */
function SemFoto() {
  return (
    <Environment resolution={256} environmentIntensity={INTENSIDADE}>
      <Recortes />
    </Environment>
  );
}

/**
 * Reflexos nos copos, no verniz e no piso. Enquanto a foto 360° chega, ou se ela não
 * carregar, ficam só os recortes de luz. No nível baixo a foto nem é baixada.
 */
export function Ambiente({ comFoto = true }: { comFoto?: boolean }) {
  if (!comFoto) return <SemFoto />;
  return (
    <LimiteDeErro reserva={<SemFoto />}>
      <Suspense fallback={<SemFoto />}>
        <ComFoto />
      </Suspense>
    </LimiteDeErro>
  );
}
