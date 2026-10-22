"use client";

import { OrbitControls, type OrbitControlsChangeEvent } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  type ComponentRef,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";

import { situacao } from "@/lib/salao";
import type { Mesa } from "@/lib/tipos";

import { Ambiente } from "./ambiente";
import { vestirSalao } from "./aparencia";
import { CameraDoSalao } from "./camera-giro";
import { useQualidade } from "./contexto-qualidade";
import { useCoresDoSalao, useCoresNaCena } from "./cores";
import { MesaNoSalao3D } from "./mesa-3d";
import { MARGEM, type PlantaSalao } from "./planta";
import { ALTURA_PAREDE, Sala } from "./sala";

/** Garçom aparece junto da mesa logo depois do atendimento, como a câmera o veria. */
const GARCOM_NA_MESA_MS = 45_000;
const ALTURA_ROTULO = 1.9;
export const ALVO_INICIAL: [number, number, number] = [0, 0.3, 0.4];
/** De onde a vista começa: de frente, um pouco pela direita e do alto (ângulos em radianos). */
export const DIRECAO_INICIAL = { elevacao: 0.8, giro: 0.22 };
/** Abaixo desta largura (a mesma do `@max-lg` das placas), a placa fica compacta. */
const LARGURA_PLACA_COMPACTA = 512;
/** Placa da câmera do salão (só aparece no modo "como a câmera vê"). */
export const ANCORA_CAMERA = "camera";

export type Controles = ComponentRef<typeof OrbitControls>;

/** Onde uma placa da página deve aparecer na tela, em pixels dentro da área do 3D. */
export type AoProjetar = (
  id: string,
  x: number,
  y: number,
  visivel: boolean,
  perto: number,
) => void;

interface Ancora {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface PropsCena {
  planta: PlantaSalao;
  agoraMs: number;
  limiteSeg: number;
  nome: string;
  verComoCamera: boolean;
  movimentoReduzido: boolean;
  controles: RefObject<Controles | null>;
  aoAbrir: (mesaId: number) => void;
  aoProjetar: AoProjetar;
}

export function Cena({
  planta,
  agoraMs,
  limiteSeg,
  nome,
  verComoCamera,
  movimentoReduzido,
  controles,
  aoAbrir,
  aoProjetar,
}: PropsCena) {
  const cores = useCoresDoSalao();
  const qualidade = useQualidade();
  const coresTela = useCoresNaCena(cores, qualidade.efeitos);
  const { largura, profundidade } = planta;
  const maior = Math.max(largura, profundidade);
  const posicaoCamera = useMemo<[number, number, number]>(
    () => [-largura / 2 + 0.4, ALTURA_PAREDE - 0.3, -profundidade / 2 + 0.4],
    [largura, profundidade],
  );
  const area = useMemo(
    () => ({ x: largura / 2 - MARGEM + 0.5, z: profundidade / 2 - MARGEM + 0.5 }),
    [largura, profundidade],
  );
  const ancoras = useMemo<Ancora[]>(
    () => [
      ...planta.mesas.map((m) => ({ id: String(m.mesa.id), x: m.x, y: ALTURA_ROTULO, z: m.z })),
      {
        id: ANCORA_CAMERA,
        x: posicaoCamera[0] + 0.3,
        y: posicaoCamera[1] + 0.25,
        z: posicaoCamera[2] + 0.5,
      },
    ],
    [planta, posicaoCamera],
  );

  /** Não deixa arrastar o salão para fora da tela. */
  function limitarAlvo(evento?: OrbitControlsChangeEvent) {
    const alvo = evento?.target.target;
    if (!alvo) return;
    alvo.x = Math.max(-largura / 2, Math.min(largura / 2, alvo.x));
    alvo.z = Math.max(-profundidade / 2, Math.min(profundidade / 2, alvo.z));
    alvo.y = Math.max(0, Math.min(1.5, alvo.y));
  }

  const comSombra = qualidade.sombras !== "nenhuma";

  return (
    <>
      <ControleDoDesenho planta={planta} agoraMs={agoraMs} texturas={qualidade.texturas} />

      {/* Interior quente à noite: o céu do hemisfério é o teto iluminado, o chão é madeira. */}
      <hemisphereLight args={["#ffdfb8", "#2a1b12", 0.5]} />
      <ambientLight intensity={0.08} color="#ffd9b0" />
      {/* A única luz com sombra: o lustre do teto, um pouco à direita e à frente. */}
      <directionalLight
        key={qualidade.mapaSombra}
        position={[largura * 0.22, 9, profundidade * 0.32]}
        intensity={1.45}
        color="#ffd7ad"
        castShadow={comSombra}
        shadow-mapSize={[qualidade.mapaSombra || 512, qualidade.mapaSombra || 512]}
        shadow-camera-left={-maior / 2 - 1}
        shadow-camera-right={maior / 2 + 1}
        shadow-camera-top={maior / 2 + 1}
        shadow-camera-bottom={-maior / 2 - 1}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={qualidade.sombras === "dinamicas" ? 5 : 3}
      />
      <Ambiente />

      <Sala largura={largura} profundidade={profundidade} nome={nome} />

      {planta.mesas.map((item) => (
        <MesaNoSalao3D
          key={item.mesa.id}
          item={item}
          tom={situacao(item.mesa, agoraMs, limiteSeg).tom}
          sentados={pessoasSentadas(item.mesa)}
          comGarcom={garcomNaMesa(item.mesa, agoraMs)}
          verComoCamera={verComoCamera}
          movimentoReduzido={movimentoReduzido}
          cores={cores}
          coresTela={coresTela}
          aoAbrir={aoAbrir}
        />
      ))}

      <CameraDoSalao
        posicao={posicaoCamera}
        area={area}
        cor={coresTela.foco}
        verComoCamera={verComoCamera}
        movimentoReduzido={movimentoReduzido}
      />

      <Projetor ancoras={ancoras} aoProjetar={aoProjetar} />
      <Enquadrar planta={planta} />

      <OrbitControls
        ref={controles}
        makeDefault
        target={ALVO_INICIAL}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.55}
        zoomSpeed={0.8}
        panSpeed={0.7}
        minDistance={4}
        maxDistance={maior * 3.5} // celular em pé precisa ver de mais longe para caber tudo
        minPolarAngle={0.2}
        maxPolarAngle={1.2}
        // Só de frente e da direita: por trás, as paredes da maquete tapariam o salão.
        minAzimuthAngle={-0.45}
        maxAzimuthAngle={1.35}
        onChange={limitarAlvo}
      />
    </>
  );
}

/**
 * Liga o desenho ao nível de acabamento:
 * - sombra: refeita a cada quadro só no nível alto ("dinamicas"); nos outros, só quando
 *   alguém chama `useRefazerSombra` (as mesas e a sala chamam quando mudam);
 * - Canvas sob demanda (nível baixo): pede um quadro novo quando os dados ou o relógio mudam;
 * - texturas PBR: geradas aos poucos e vestidas nos materiais quando ficam prontas.
 */
function ControleDoDesenho({
  planta,
  agoraMs,
  texturas,
}: {
  planta: PlantaSalao;
  agoraMs: number;
  texturas: number;
}) {
  const { sombras } = useQualidade();
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    const { gl } = get();
    gl.shadowMap.autoUpdate = sombras === "dinamicas";
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [get, sombras, invalidate]);

  useEffect(() => {
    invalidate();
  }, [planta, agoraMs, invalidate]);

  useEffect(() => {
    let vivo = true;
    vestirSalao(texturas)
      .then((mudou) => {
        if (vivo && mudou) invalidate();
      })
      .catch(() => {}); // sem textura, o salão fica com as cores lisas
    return () => {
      vivo = false;
    };
  }, [texturas, invalidate]);

  return null;
}

const PONTO = new THREE.Vector3();

/**
 * A cada quadro, calcula onde cada ponto do salão cai na tela e avisa a página, que move
 * as placas das mesas (botões comuns) para cima delas.
 */
function Projetor({ ancoras, aoProjetar }: { ancoras: Ancora[]; aoProjetar: AoProjetar }) {
  useFrame(({ camera, size }) => {
    for (const a of ancoras) {
      PONTO.set(a.x, a.y, a.z).project(camera);
      const naFrente = PONTO.z < 1 && Math.abs(PONTO.x) < 1.2 && Math.abs(PONTO.y) < 1.2;
      aoProjetar(
        a.id,
        ((PONTO.x + 1) / 2) * size.width,
        ((1 - PONTO.y) / 2) * size.height,
        naFrente,
        1 - PONTO.z,
      );
    }
  });
  return null;
}

/**
 * No primeiro quadro, afasta a câmera só o necessário para caber todas as mesas e o
 * letreiro do fundo na área do 3D, seja qual for o tamanho da tela. Essa vira a vista
 * inicial do botão "Voltar à vista inicial".
 */
function Enquadrar({ planta }: { planta: PlantaSalao }) {
  const feito = useRef(false);
  useFrame(({ camera, size, controls, invalidate }) => {
    if (feito.current || size.width === 0 || !controls) return; // espera os controles
    feito.current = true;
    const pontos = cantosParaCaber(planta);
    // As placas têm tamanho fixo em pixels: sobra borda para elas (menos com a placa compacta).
    const placas = planta.mesas.map((m) => new THREE.Vector3(m.x, ALTURA_ROTULO, m.z));
    const compacta = size.width < LARGURA_PLACA_COMPACTA;
    const bordaX = 1 - (compacta ? 70 : 130) / size.width;
    const bordaY = 1 - (compacta ? 40 : 70) / size.height;
    const alvo = new THREE.Vector3(...ALVO_INICIAL);
    // Celular em pé: vista mais de cima, para as fileiras de mesas se separarem na tela.
    const elevacao = size.height > size.width ? 1.08 : DIRECAO_INICIAL.elevacao;
    const { giro } = DIRECAO_INICIAL;
    const direcao = new THREE.Vector3(
      Math.sin(giro) * Math.cos(elevacao),
      Math.sin(elevacao),
      Math.cos(giro) * Math.cos(elevacao),
    );
    const cabe = (distancia: number) => {
      camera.position.copy(alvo).addScaledVector(direcao, distancia);
      camera.lookAt(alvo);
      camera.updateMatrixWorld();
      const dentro = (p: THREE.Vector3, limiteX: number, limiteY: number) => {
        PONTO.copy(p).project(camera);
        return Math.abs(PONTO.x) <= limiteX && Math.abs(PONTO.y) <= limiteY;
      };
      return (
        pontos.every((p) => dentro(p, 0.94, 0.92)) && placas.every((p) => dentro(p, bordaX, bordaY))
      );
    };
    let perto = 3;
    let longe = 80;
    for (let i = 0; i < 24; i++) {
      const meio = (perto + longe) / 2;
      if (cabe(meio)) longe = meio;
      else perto = meio;
    }
    cabe(longe);
    const orbita = controls as unknown as Controles | null;
    orbita?.target.copy(alvo);
    orbita?.update();
    orbita?.saveState();
    invalidate(); // no Canvas sob demanda, o próximo quadro já sai enquadrado
  });
  return null;
}

/** Cantos da área das mesas, até a altura das placas, e o alto da parede do fundo (letreiro). */
function cantosParaCaber(planta: PlantaSalao): THREE.Vector3[] {
  if (planta.mesas.length === 0) return [new THREE.Vector3(0, 0, 0)];
  const xs = planta.mesas.flatMap((m) => [m.x - m.meiaPegada.x, m.x + m.meiaPegada.x]);
  const zs = planta.mesas.flatMap((m) => [m.z - m.meiaPegada.z, m.z + m.meiaPegada.z]);
  const [x0, x1] = [Math.min(...xs) - 0.3, Math.max(...xs) + 0.3];
  const [z0, z1] = [Math.min(...zs) - 0.3, Math.max(...zs) + 0.3];
  const pontos: THREE.Vector3[] = [];
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) {
      pontos.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, ALTURA_ROTULO + 0.3, z));
    }
  }
  pontos.push(new THREE.Vector3(0, 2.55, -planta.profundidade / 2)); // letreiro
  return pontos;
}

function pessoasSentadas(mesa: Mesa): number {
  if (mesa.estado !== "aguardando" && mesa.estado !== "ocupada") return 0;
  return Math.min(Math.max(mesa.pessoas, 1), mesa.lugares);
}

function garcomNaMesa(mesa: Mesa, agoraMs: number): boolean {
  if (mesa.estado !== "ocupada" || !mesa.atendida_em) return false;
  return agoraMs - Date.parse(mesa.atendida_em) < GARCOM_NA_MESA_MS;
}
