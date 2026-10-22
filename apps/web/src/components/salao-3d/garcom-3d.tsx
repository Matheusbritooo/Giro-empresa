"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as clonarComEsqueleto } from "three/addons/utils/SkeletonUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

import type { Alerta, Mesa } from "@/lib/tipos";

import { useQualidade, useRefazerSombra } from "./contexto-qualidade";
import {
  comprimento,
  estacaoDoGarcom,
  planejarGarcom,
  type Ponto,
  type PontoComRotacao,
  pontoDeAtendimento,
  pontoNaRota,
  rotaAte,
} from "./garcom";
import { MANIFESTO, URL_GARCOM } from "./modelos";
import { Contorno } from "./pessoas";
import type { PlantaSalao } from "./planta";

type Acao = "parado" | "andando" | "anotando";

/** Tempo da troca suave entre um clipe e outro (s). */
const TROCA = 0.35;
/** Quão rápido o corpo vira para a nova direção (por segundo). */
const VIRADA = 8;
/** Quadro de cada clipe que fica na tela quando o garçom não anima (nível baixo, CI). */
const QUADRO_PARADO: Record<Acao, number> = { parado: 0, andando: 0, anotando: 2 };

interface Movimento {
  rota: Ponto[];
  total: number;
  andado: number;
}

interface Estado {
  x: number;
  z: number;
  rotacao: number;
  alvoRotacao: number;
  acao: Acao;
  /** Ação de quando chegar (anotando junto da mesa, parado no balcão). */
  final: Acao;
  /** Para onde olhar quando chegar. */
  rotacaoFinal: number;
  movimento: Movimento | null;
  destino: string;
}

/** Diferença de ângulo pelo lado mais curto, entre -π e π. */
function diferencaDeAngulo(de: number, para: number): number {
  return Math.atan2(Math.sin(para - de), Math.cos(para - de));
}

/**
 * O garçom do salão (Rocketbox, MIT), com esqueleto e três clipes: parado, andando e
 * anotando. Vai para a mesa que pediu atendimento ("Vou atender") ou que acabou de ser
 * atendida, sempre pelos corredores, e depois volta para o balcão. É ilustrativo: a câmera
 * só vê alguém em pé junto da mesa.
 *
 * Sem animação (nível baixo, movimento reduzido), ele aparece direto no destino.
 */
export function Garcom3D({
  planta,
  mesas,
  alertas,
  agoraMs,
  verComoCamera,
  corContorno,
  parado,
  aoMudarDestino,
}: {
  planta: PlantaSalao;
  mesas: Mesa[];
  alertas: Alerta[];
  agoraMs: number;
  verComoCamera: boolean;
  corContorno: THREE.ColorRepresentation;
  /** Sem animação: vai direto ao destino e fica numa pose só. */
  parado: boolean;
  /** Avisa para onde ele está indo ("mesa-7" ou "balcao"), para a página e os testes. */
  aoMudarDestino?: (destino: string) => void;
}) {
  const modelo = useGLTF(URL_GARCOM, false, true) as unknown as GLTF;
  const { sombras } = useQualidade();
  const refazerSombra = useRefazerSombra();
  const corpo = useRef<THREE.Group>(null);
  const estado = useRef<Estado | null>(null);

  // Cada garçom na tela precisa do próprio esqueleto: clona com os ossos.
  const { cena, mixer, acoes } = useMemo(() => {
    const cena = clonarComEsqueleto(modelo.scene) as THREE.Object3D;
    cena.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; // ossos andam fora da caixa
    });
    const mixer = new THREE.AnimationMixer(cena);
    const acoes = new Map<Acao, THREE.AnimationAction>();
    for (const clipe of modelo.animations) {
      acoes.set(clipe.name as Acao, mixer.clipAction(clipe));
    }
    return { cena, mixer, acoes };
  }, [modelo]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(cena);
    },
    [mixer, cena],
  );

  // Para onde ir agora.
  const plano = planejarGarcom(mesas, alertas, agoraMs);
  const item = plano ? planta.mesas.find((m) => m.mesa.id === plano.mesaId) : undefined;
  const destino: PontoComRotacao = item ? pontoDeAtendimento(item) : estacaoDoGarcom(planta);
  const nomeDestino = item ? `mesa-${item.mesa.numero}` : "balcao";
  const final: Acao = item ? "anotando" : "parado";
  const chaveDestino = `${nomeDestino}:${destino.x.toFixed(3)}:${destino.z.toFixed(3)}`;

  /** Troca de clipe com fusão suave (ou seco, quando não anima). */
  function tocar(acao: Acao, suave: boolean) {
    const e = estado.current;
    const nova = acoes.get(acao);
    if (!nova || !e) return;
    const antiga = acoes.get(e.acao);
    e.acao = acao;
    if (!suave) {
      mixer.stopAllAction();
      nova.reset().play();
      nova.time = QUADRO_PARADO[acao];
      mixer.update(0);
      return;
    }
    if (antiga === nova && nova.isRunning()) return;
    nova.reset().setEffectiveWeight(1).fadeIn(TROCA).play();
    if (antiga && antiga !== nova) antiga.fadeOut(TROCA);
  }

  /** Sombra: no nível alto ela acompanha a cada quadro; no médio, só com o garçom parado. */
  function ajustarSombra(andando: boolean) {
    const projeta = sombras === "dinamicas" || (sombras === "estaticas" && !andando);
    cena.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = projeta;
    });
    refazerSombra();
  }

  function aplicar() {
    const e = estado.current;
    if (!e || !corpo.current) return;
    corpo.current.position.set(e.x, 0, e.z);
    corpo.current.rotation.y = e.rotacao;
  }

  useLayoutEffect(() => {
    const atual = estado.current;
    if (atual && atual.destino === chaveDestino && !parado) return;
    aoMudarDestino?.(nomeDestino);

    if (!atual || parado) {
      // Primeira vez ou sem animação: aparece direto no destino.
      estado.current = {
        x: destino.x,
        z: destino.z,
        rotacao: destino.rotacao,
        alvoRotacao: destino.rotacao,
        acao: final,
        final,
        rotacaoFinal: destino.rotacao,
        movimento: null,
        destino: chaveDestino,
      };
      tocar(final, false);
      if (!parado) tocar(final, true);
      aplicar();
      ajustarSombra(false);
      return;
    }

    const rota = rotaAte(planta, { x: atual.x, z: atual.z }, destino);
    const total = comprimento(rota);
    atual.destino = chaveDestino;
    atual.final = final;
    atual.rotacaoFinal = destino.rotacao;
    if (total < 0.05) {
      atual.movimento = null;
      atual.alvoRotacao = destino.rotacao;
      tocar(final, true);
      return;
    }
    atual.movimento = { rota, total, andado: 0 };
    tocar("andando", true);
    ajustarSombra(true);
    // As funções acima leem o estado da vez; o que muda o destino está na chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDestino, parado]);

  useLayoutEffect(() => {
    ajustarSombra(estado.current?.movimento != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sombras]);

  useFrame((_, delta) => {
    const e = estado.current;
    if (!e || parado) return;
    const dt = Math.min(delta, 0.1); // aba que volta do fundo não faz o garçom teleportar
    const m = e.movimento;
    if (m) {
      m.andado += MANIFESTO.garcom.velocidade * dt;
      const p = pontoNaRota(m.rota, m.andado);
      e.x = p.x;
      e.z = p.z;
      e.alvoRotacao = p.rotacao;
      if (m.andado >= m.total) {
        e.movimento = null;
        const ultimo = m.rota[m.rota.length - 1];
        e.x = ultimo.x;
        e.z = ultimo.z;
        e.alvoRotacao = e.rotacaoFinal;
        tocar(e.final, true);
        ajustarSombra(false);
      }
    }
    e.rotacao += diferencaDeAngulo(e.rotacao, e.alvoRotacao) * Math.min(1, dt * VIRADA);
    aplicar();
    mixer.update(dt);
  });

  return (
    <group ref={corpo}>
      <primitive object={cena} />
      {verComoCamera && <Contorno emPe cor={corContorno} />}
    </group>
  );
}

useGLTF.preload(URL_GARCOM, false, true);
