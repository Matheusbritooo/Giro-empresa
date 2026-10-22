"use client";

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMovimentoReduzido } from "@/lib/midia";
import { situacao, tempoDecorrido } from "@/lib/salao";
import type { Mesa } from "@/lib/tipos";

import { ALVO_INICIAL, ANCORA_CAMERA, Cena, type Controles, DIRECAO_INICIAL } from "./cena";
import { montarPlanta } from "./planta";
import { RotuloMesa } from "./rotulo";

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
  agoraMs,
  limiteSeg,
  nome,
  aoAbrir,
}: {
  mesas: Mesa[];
  agoraMs: number;
  limiteSeg: number;
  nome: string;
  aoAbrir: (mesaId: number) => void;
}) {
  const [verComoCamera, setVerComoCamera] = useState(false);
  const movimentoReduzido = useMovimentoReduzido();
  const controles = useRef<Controles>(null);
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

  return (
    <div
      className="@container relative isolate h-[min(68vh,660px)] min-h-[380px] overflow-hidden rounded-2xl border border-linha bg-superficie"
      data-testid="salao-3d"
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 32, near: 0.1, far: 160, position: posicaoInicial }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 1.08;
        }}
        aria-label="Salão em 3D. Arraste para girar e use a roda do mouse ou dois dedos para aproximar."
      >
        <Cena
          planta={planta}
          agoraMs={agoraMs}
          limiteSeg={limiteSeg}
          nome={nome}
          verComoCamera={verComoCamera}
          movimentoReduzido={movimentoReduzido}
          controles={controles}
          aoAbrir={aoAbrir}
          aoProjetar={projetar}
        />
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
        <p className="pointer-events-none absolute top-3 right-3 z-[2000] max-w-[22rem] rounded-lg bg-tinta/85 px-3 py-2 text-sm text-fundo">
          A câmera enxerga formas, não rostos. Ela só conta quem está sentado em cada mesa (contorno
          branco) e quem está em pé junto dela (contorno amarelo).
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
          onClick={() => controles.current?.reset()}
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
