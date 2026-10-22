"use client";

/**
 * Acabamento da imagem do salão 3D, carregado sob demanda (só baixa em aparelho que aguenta):
 * - oclusão de ambiente (N8AO, meia resolução): escurece onde as coisas se encostam, como
 *   o pé da cadeira no chão e o prato na toalha. Só no nível alto;
 * - brilho (Bloom) só no que passa de 1: cúpulas das arandelas e o letreiro;
 * - tom ACES (o mesmo do three), vinheta leve e SMAA no lugar do antisserrilhado do navegador.
 *
 * O tom entra aqui, na imagem pronta, então as cores dos estados chegam pré-corrigidas
 * (cores.ts / tom.ts) para continuarem iguais às do painel.
 */

import {
  Bloom,
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { ReactElement } from "react";

export default function Efeitos({ oclusao }: { oclusao: boolean }) {
  const efeitos: ReactElement[] = [];
  if (oclusao) {
    efeitos.push(
      <N8AO
        key="oclusao"
        halfRes
        quality="performance"
        aoRadius={0.55}
        distanceFalloff={0.6}
        intensity={2.2}
      />,
    );
  }
  efeitos.push(
    <Bloom
      key="brilho"
      mipmapBlur
      luminanceThreshold={1}
      luminanceSmoothing={0.1}
      intensity={0.7}
    />,
    <ToneMapping key="tom" mode={ToneMappingMode.ACES_FILMIC} />,
    <Vignette key="vinheta" offset={0.32} darkness={0.42} />,
    <SMAA key="smaa" />,
  );
  // Sem multisampling: o SMAA já alisa as bordas e custa bem menos.
  return <EffectComposer multisampling={0}>{efeitos}</EffectComposer>;
}
