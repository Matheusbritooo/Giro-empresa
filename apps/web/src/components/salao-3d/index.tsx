"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { NoToneMapping } from "three";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LimiteDeErro } from "@/components/limite-de-erro";
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
/** Se a placa de vídeo some e não volta nesse tempo, a página mostra a planta. */
const ESPERA_CONTEXTO_MS = 5000;
/** Distância mínima entre uma placa e a borda da área do 3D (px). */
const MARGEM_PLACA = 8;

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
  calor = null,
  aoAbrir,
  aoFalhar,
}: {
  mesas: Mesa[];
  alertas: Alerta[];
  agoraMs: number;
  limiteSeg: number;
  nome: string;
  /** Leva a câmera até esta mesa ("Ver no salão" nos alertas). */
  foco?: PedidoDeFoco | null;
  /** Mapa de calor do replay da noite (mesa → 0 a 1). */
  calor?: ReadonlyMap<number, number> | null;
  aoAbrir: (mesaId: number) => void;
  /** O 3D não tem como continuar (a placa de vídeo sumiu e não voltou). */
  aoFalhar?: () => void;
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
  const placas = useRef(
    new Map<string, { elemento: HTMLElement; largura: number; altura: number }>(),
  );
  const area = useRef<HTMLDivElement>(null);
  const tamanhoArea = useRef({ largura: 0, altura: 0 });
  const aoFalharRef = useRef(aoFalhar);
  const esperaContexto = useRef<ReturnType<typeof setTimeout>>(undefined);
  const desligado = useRef(false);
  const planta = useMemo(() => montarPlanta(mesas), [mesas]);
  // A câmera do Canvas só usa a posição inicial; depois quem manda é quem arrasta.
  const [posicaoInicial] = useState(() => vistaInicial(planta.largura, planta.profundidade));

  useEffect(() => {
    aoFalharRef.current = aoFalhar;
  }, [aoFalhar]);

  // Ao sair da tela: o cursor volta ao normal (se o mouse estava numa mesa) e a perda do
  // contexto que o próprio desligar do 3D provoca não conta como falha.
  useEffect(() => {
    desligado.current = false;
    return () => {
      desligado.current = true;
      clearTimeout(esperaContexto.current);
      document.body.style.cursor = "";
    };
  }, []);

  // Tamanho da área do 3D, para as placas não saírem cortadas pela borda.
  useEffect(() => {
    const elemento = area.current;
    if (!elemento) return;
    const medir = () => {
      tamanhoArea.current = { largura: elemento.clientWidth, altura: elemento.clientHeight };
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  /**
   * Guarda o botão de cada placa (e o tamanho dele) para o projetor movê-lo sem redesenhar a
   * página. Medir aqui, uma vez por renderização, evita ler o layout a cada quadro.
   */
  const registrar = useCallback(
    (id: string) => (elemento: HTMLElement | null) => {
      if (elemento) {
        placas.current.set(id, {
          elemento,
          largura: elemento.offsetWidth,
          altura: elemento.offsetHeight,
        });
      } else {
        placas.current.delete(id);
      }
    },
    [],
  );

  const projetar = useCallback(
    (id: string, x: number, y: number, visivel: boolean, perto: number) => {
      const placa = placas.current.get(id);
      if (!placa) return;
      // De perto, a placa poderia sair da área: fica presa dentro dela, com uma folga.
      const { largura, altura } = tamanhoArea.current;
      const meiaL = placa.largura / 2 + MARGEM_PLACA;
      const meiaA = placa.altura / 2 + MARGEM_PLACA;
      const px = largura > 2 * meiaL ? Math.min(Math.max(x, meiaL), largura - meiaL) : x;
      const py = altura > 2 * meiaA ? Math.min(Math.max(y, meiaA), altura - meiaA) : y;
      const estilo = placa.elemento.style;
      estilo.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
      estilo.visibility = visivel ? "visible" : "hidden";
      estilo.zIndex = String(Math.round(perto * 1000)); // a mais perto fica por cima
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
      className="@container flex flex-col overflow-hidden rounded-2xl border border-linha bg-superficie"
      data-testid="salao-3d"
      data-qualidade={nivel}
    >
      <div
        ref={area}
        data-testid="salao-3d-area"
        className="relative isolate h-[min(64vh,620px)] min-h-[360px]"
      >
        <Canvas
          shadows={ajustes.sombras === "nenhuma" ? false : "percentage"}
          dpr={ajustes.dpr}
          frameloop={ajustes.animar ? "always" : "demand"}
          camera={{ fov: 32, near: 0.1, far: 160, position: posicaoInicial }}
          // Antisserrilhado sempre: se o aparelho cair para o nível sem efeitos (sem SMAA) no
          // meio do uso, o renderizador já criado não ganha antisserrilhado depois.
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = EXPOSICAO;
            // Com os efeitos, o tom sai no EffectComposer: já nasce sem tom para não recompilar tudo.
            if (ajustes.efeitos) gl.toneMapping = NoToneMapping;
            gl.shadowMap.autoUpdate = ajustes.sombras === "dinamicas";
            // Placa de vídeo perdida (driver reiniciou, aba em segundo plano no celular): se não
            // voltar logo, a página mostra a planta em vez de um quadro em branco.
            gl.domElement.addEventListener("webglcontextlost", () => {
              if (desligado.current) return;
              clearTimeout(esperaContexto.current);
              esperaContexto.current = setTimeout(
                () => aoFalharRef.current?.(),
                ESPERA_CONTEXTO_MS,
              );
            });
            gl.domElement.addEventListener("webglcontextrestored", () =>
              clearTimeout(esperaContexto.current),
            );
          }}
          aria-label="Salão em 3D. Arraste para girar e use a roda do mouse ou dois dedos para aproximar."
        >
          <QualidadeProvider nivel={nivel}>
            {/* Cena e efeitos no mesmo Suspense: o primeiro quadro já passa pelo EffectComposer e os shaders compilam uma vez só. */}
            <Suspense fallback={null}>
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
                calor={calor}
              />
              {/* Sem os efeitos (se o pedaço não carregar), o salão segue com a imagem simples. */}
              {ajustes.efeitos && (
                <LimiteDeErro reserva={null}>
                  <Efeitos oclusao={ajustes.oclusao} />
                </LimiteDeErro>
              )}
            </Suspense>
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

        {verComoCamera && (
          <p className="pointer-events-none absolute top-3 right-3 z-[2000] max-w-[min(22rem,calc(100%-1.5rem))] rounded-lg bg-tinta/85 px-3 py-2 text-sm text-fundo">
            A câmera enxerga formas, não rostos. Ela só conta quem está sentado em cada mesa
            (contorno branco) e quem está em pé junto dela (contorno amarelo).
          </p>
        )}

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
      </div>

      {/* Faixa fixa embaixo do 3D: o selo nunca cobre placa nem é coberto por elas. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-linha px-3 py-2 text-xs">
        {/* As pessoas do 3D são desenho: a câmera do restaurante não filma nem guarda imagem. */}
        <p data-testid="selo-ilustrativo" className="font-semibold text-tinta">
          Pessoas ilustrativas: a câmera só conta, não filma ninguém.
        </p>
        <p className="flex flex-wrap items-center gap-x-3 text-tinta-suave">
          <span className="hidden md:inline">Arraste para girar. Role para aproximar.</span>
          <a
            href="/modelos/CREDITOS.md"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2 hover:text-tinta"
          >
            Créditos dos desenhos
          </a>
        </p>
      </div>
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
