"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMovimentoReduzido } from "@/lib/midia";
import { situacao, tempoDecorrido } from "@/lib/salao";
import type { Alerta, Mesa } from "@/lib/tipos";

import { ALVO_INICIAL, ANCORA_CAMERA, Cena, type Controles, DIRECAO_INICIAL } from "./cena";
import { QualidadeProvider } from "./contexto-qualidade";
import { montarPlanta } from "./planta";
import {
  ajustesDoNivel,
  escolherNivel,
  type Nivel,
  nivelAbaixo,
  nivelForcado,
  sondarNavegador,
} from "./qualidade";
import { RotuloMesa } from "./rotulo";
import { EXPOSICAO } from "./tom";
import type { PedidoDeFoco, Voo } from "./voo-camera";

export type { PedidoDeFoco } from "./voo-camera";

// Os efeitos (postprocessing) só são baixados quando o aparelho aguenta usá-los.
const Efeitos = lazy(() => import("./efeitos"));
/** Espera o salão assentar (texturas, primeiros quadros) antes de medir se está travando. */
const ESPERA_PARA_MEDIR_MS = 4000;

/** Primeira posição da câmera, antes do ajuste fino que faz o salão caber na tela. */
function vistaInicial(largura: number, profundidade: number): [number, number, number] {
  const distancia = Math.max(largura, profundidade * 1.25) + 2;
  const { elevacao, giro } = DIRECAO_INICIAL;
  const [ax, ay, az] = ALVO_INICIAL;
  return [
    ax + Math.sin(giro) * Math.cos(elevacao) * distancia,
    ay + Math.sin(elevacao) * distancia,
    az + Math.cos(giro) * Math.cos(elevacao) * distancia,
  ];
}

/**
 * O salão em 3D, ligado aos mesmos dados ao vivo da planta. Tocar numa mesa (ou na placa
 * dela) abre o mesmo detalhe, com "Liberar mesa".
 */
export default function Salao3D({
  mesas,
  alertas,
  agoraMs,
  limiteSeg,
  nome,
  foco = null,
  aoAbrir,
}: {
  mesas: Mesa[];
  alertas: Alerta[];
  agoraMs: number;
  limiteSeg: number;
  nome: string;
  /** Leva a câmera até esta mesa ("Ver no salão" nos alertas). */
  foco?: PedidoDeFoco | null;
  aoAbrir: (mesaId: number) => void;
}) {
  const [verComoCamera, setVerComoCamera] = useState(false);
  // O nível sai do aparelho; se a imagem travar, o monitor desce um nível (nunca sobe).
  const [aparelho] = useState(sondarNavegador);
  const [nivel, setNivel] = useState<Nivel>(() => escolherNivel(aparelho));
  const forcado = nivelForcado(aparelho) !== null;
  const ajustes = ajustesDoNivel(nivel);
  const baixarNivel = useCallback(() => setNivel(nivelAbaixo), []);
  const movimentoReduzido = useMovimentoReduzido();
  const controles = useRef<Controles>(null);
  const voo = useRef<Voo>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const placas = useRef(new Map<string, HTMLElement>());
  const planta = useMemo(() => montarPlanta(mesas), [mesas]);
  // A câmera do Canvas só usa a posição inicial; depois quem manda é quem arrasta.
  const [posicaoInicial] = useState(() => vistaInicial(planta.largura, planta.profundidade));

  // Se o 3D sair da tela com o mouse em cima de uma mesa, o cursor volta ao normal.
  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    [],
  );

  /** Guarda o botão de cada placa para o projetor movê-lo sem redesenhar a página. */
  const registrar = useCallback(
    (id: string) => (elemento: HTMLElement | null) => {
      if (elemento) placas.current.set(id, elemento);
      else placas.current.delete(id);
    },
    [],
  );

  const projetar = useCallback(
    (id: string, x: number, y: number, visivel: boolean, perto: number) => {
      const placa = placas.current.get(id);
      if (!placa) return;
      placa.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      placa.style.visibility = visivel ? "visible" : "hidden";
      placa.style.zIndex = String(Math.round(perto * 1000)); // a mais perto fica por cima
    },
    [],
  );

  // Marcas na própria div (sem redesenhar a página): onde a câmera parou e para onde o
  // garçom vai. Servem aos testes e a quem inspeciona a página.
  const aoChegarNaMesa = useCallback((numero: number) => {
    if (raiz.current) raiz.current.dataset.cameraEm = `mesa-${numero}`;
  }, []);
  const aoMudarDestinoGarcom = useCallback((destino: string) => {
    if (raiz.current) raiz.current.dataset.garcom = destino;
  }, []);

  function voltarAVistaInicial() {
    voo.current = null;
    controles.current?.reset();
    if (raiz.current) raiz.current.dataset.cameraEm = "inicio";
  }

  return (
    <div
      ref={raiz}
      className="@container relative isolate h-[min(68vh,660px)] min-h-[380px] overflow-hidden rounded-2xl border border-linha bg-superficie"
      data-testid="salao-3d"
      data-qualidade={nivel}
    >
      <Canvas
        shadows={ajustes.sombras === "nenhuma" ? false : "percentage"}
        dpr={ajustes.dpr}
        frameloop={ajustes.animar ? "always" : "demand"}
        camera={{ fov: 32, near: 0.1, far: 160, position: posicaoInicial }}
        // Com os efeitos, o SMAA alisa as bordas: o antisserrilhado do navegador só pesaria.
        gl={{ antialias: !ajustes.efeitos, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = EXPOSICAO;
          gl.shadowMap.autoUpdate = ajustes.sombras === "dinamicas";
        }}
        aria-label="Salão em 3D. Arraste para girar e use a roda do mouse ou dois dedos para aproximar."
      >
        <QualidadeProvider nivel={nivel}>
          <Cena
            planta={planta}
            alertas={alertas}
            agoraMs={agoraMs}
            limiteSeg={limiteSeg}
            nome={nome}
            verComoCamera={verComoCamera}
            movimentoReduzido={movimentoReduzido}
            controles={controles}
            foco={foco}
            vooRef={voo}
            aoAbrir={aoAbrir}
            aoProjetar={projetar}
            aoChegarNaMesa={aoChegarNaMesa}
            aoMudarDestinoGarcom={aoMudarDestinoGarcom}
          />
          {ajustes.efeitos && (
            <Suspense fallback={null}>
              <Efeitos oclusao={ajustes.oclusao} />
            </Suspense>
          )}
          {!forcado && nivel !== "baixo" && <VigiaDeDesempenho aoTravar={baixarNivel} />}
        </QualidadeProvider>
      </Canvas>

      {/* Placas das mesas: botões comuns, em ordem de número, que o projetor põe sobre cada mesa. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {planta.mesas.map(({ mesa }) => {
          const s = situacao(mesa, agoraMs, limiteSeg);
          return (
            <RotuloMesa
              key={mesa.id}
              ref={registrar(String(mesa.id))}
              mesa={mesa}
              situacao={s}
              cronometro={s.desde ? tempoDecorrido(s.desde, agoraMs) : null}
              aoAbrir={aoAbrir}
            />
          );
        })}
        {verComoCamera && (
          <span
            ref={registrar(ANCORA_CAMERA)}
            style={{ visibility: "hidden" }}
            className="absolute top-0 left-0 whitespace-nowrap rounded-md bg-tinta/85 px-2 py-1 text-xs font-semibold text-fundo"
          >
            Câmera do salão: 1 foto a cada 10 s
          </span>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 z-[2000] flex flex-wrap items-start justify-between gap-2">
        {/* As pessoas do 3D são desenho: a câmera do restaurante não filma nem guarda imagem. */}
        <p
          data-testid="selo-ilustrativo"
          className="max-w-[17rem] rounded-md bg-superficie/85 px-2 py-1 text-xs font-semibold text-tinta"
        >
          Pessoas ilustrativas: a câmera só conta, não filma ninguém.
        </p>
        {verComoCamera && (
          <p className="max-w-[22rem] rounded-lg bg-tinta/85 px-3 py-2 text-sm text-fundo">
            A câmera enxerga formas, não rostos. Ela só conta quem está sentado em cada mesa
            (contorno branco) e quem está em pé junto dela (contorno amarelo).
          </p>
        )}
      </div>

      <div className="absolute bottom-3 left-3 z-[2000] flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={verComoCamera}
          onClick={() => setVerComoCamera((v) => !v)}
          className={`min-h-10 rounded-lg px-3 text-sm font-semibold shadow-md ${
            verComoCamera ? "bg-ocupada text-sobre-cor" : "bg-superficie/90 text-tinta"
          }`}
        >
          Ver como a câmera
        </button>
        <button
          type="button"
          onClick={voltarAVistaInicial}
          className="min-h-10 rounded-lg bg-superficie/90 px-3 text-sm font-semibold text-tinta shadow-md"
        >
          Voltar à vista inicial
        </button>
      </div>
      <p className="pointer-events-none absolute right-3 bottom-3 z-[2000] hidden rounded-md bg-superficie/85 px-2 py-1 text-xs text-tinta-suave md:block">
        Arraste para girar. Role para aproximar.
      </p>
    </div>
  );
}

/**
 * Mede os quadros por segundo e desce um nível se o salão começar a travar (abaixo de 30).
 * Depois de 3 idas e vindas, para de mexer.
 */
function VigiaDeDesempenho({ aoTravar }: { aoTravar: () => void }) {
  const [medindo, setMedindo] = useState(false);
  useEffect(() => {
    const espera = setTimeout(() => setMedindo(true), ESPERA_PARA_MEDIR_MS);
    return () => clearTimeout(espera);
  }, []);
  if (!medindo) return null;
  return <PerformanceMonitor flipflops={3} bounds={() => [30, 55]} onDecline={aoTravar} />;
}
