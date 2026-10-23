"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LimiteDeErro } from "@/components/limite-de-erro";
import { MesaNaPlanta } from "@/components/mesa";
import {
  Contagem,
  guardarVista,
  lerVistaInicial,
  Planta,
  SeletorVista,
  type Vista,
} from "@/components/planta";
import { Aviso } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import {
  CALOR_MINIMO,
  linhaDaMesa,
  linhaDoTempo,
  type LinhaDoTempo,
  momentosDaNoite,
  salaoNoInstante,
  travasPorMesa,
} from "@/lib/replay";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { comBusca, horaLocal, lerDia, noitePadrao, rotuloDia } from "@/lib/resultados";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import type { Replay } from "@/lib/tipos";
import { temWebGL } from "@/lib/webgl";

import type { PedidoDeFoco } from "@/components/salao-3d";

const Salao3D = dynamic(() => import("@/components/salao-3d"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[min(64vh,620px)] min-h-[360px] place-items-center rounded-2xl border border-linha bg-superficie text-tinta-suave">
      Montando o salão em 3D...
    </div>
  ),
});

const MINUTO = 60_000;
/** Quantas vezes por segundo o relógio do replay anda. */
const PASSOS_POR_SEGUNDO = 5;
const VELOCIDADES = [
  { rotulo: "Devagar", minutosPorSegundo: 2 },
  { rotulo: "Normal", minutosPorSegundo: 6 },
  { rotulo: "Rápido", minutosPorSegundo: 15 },
];

export default function PaginaReplay() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
  const [hoje] = useState(() => noitePadrao(Date.now(), sessao?.restaurante?.abre_as ?? "18:00"));
  const pedido = lerDia(parametros.get("dia"));
  const dia = pedido && pedido <= hoje ? pedido : hoje;
  const buscar = useCallback(
    () => api<Replay>(`/api/resultados/replay?dia=${dia}`, { restaurante }),
    [dia, restaurante],
  );
  const { dados: replay, erro } = useDados(restaurante ? buscar : null);
  const voltar = comBusca("/resultados", parametros, {});

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  if (sessao && !podeGerirMesas(sessao.usuario.papel)) {
    return <Aviso>O replay da noite fica com o dono e o gerente.</Aviso>;
  }

  const linha = replay && replay.dia === dia ? linhaDoTempo(replay) : null;

  return (
    <>
      <Link href={voltar} className="self-start font-semibold text-tinta-suave hover:text-tinta">
        <span aria-hidden>‹ </span>Voltar aos resultados
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="font-placa text-4xl font-extrabold leading-none">Replay da noite</h1>
        <p className="text-lg text-tinta-suave">{rotuloDia(dia)}</p>
      </header>
      <Aviso>{erro}</Aviso>
      {!replay || replay.dia !== dia ? (
        !erro && <p className="text-tinta-suave">Buscando os horários da noite...</p>
      ) : !linha ? (
        <div className="rounded-xl border-2 border-dashed border-linha p-6">
          <p className="font-semibold">Nenhuma mesa foi registrada nessa noite.</p>
          <p className="text-tinta-suave">
            <Link href={voltar} className="font-semibold text-tinta underline">
              Escolha outra noite
            </Link>{" "}
            nos resultados.
          </p>
        </div>
      ) : (
        <ReplayDaNoite
          key={replay.dia}
          replay={replay}
          linha={linha}
          nome={sessao?.restaurante?.nome ?? "GIRO"}
        />
      )}
    </>
  );
}

function ReplayDaNoite({
  replay,
  linha,
  nome,
}: {
  replay: Replay;
  linha: LinhaDoTempo;
  nome: string;
}) {
  const [instante, setInstante] = useState(linha.inicioMs);
  const [tocando, setTocando] = useState(false);
  const [velocidade, setVelocidade] = useState(1);
  const [comCalor, setComCalor] = useState(false);
  const [vista, setVista] = useState<Vista>(lerVistaInicial);
  const [com3D, setCom3D] = useState(() => typeof window !== "undefined" && temWebGL());
  const [foco, setFoco] = useState<PedidoDeFoco | null>(null);
  const [mesaAberta, setMesaAberta] = useState<number | null>(null);

  const noFim = instante >= linha.fimMs;
  const andando = tocando && !noFim;
  /** Quantos ms da noite passam a cada ms de verdade. */
  const ritmo = (VELOCIDADES[velocidade].minutosPorSegundo * MINUTO) / 1000;

  // O relógio anda pelo tempo de verdade, não por passos: num aparelho lento, que desenha
  // menos vezes por segundo, o replay pula mais minutos por vez em vez de ficar mais lento.
  useEffect(() => {
    if (!andando) return;
    let ultimo = performance.now();
    const relogio = setInterval(() => {
      const agora = performance.now();
      const passou = (agora - ultimo) * ritmo;
      ultimo = agora;
      setInstante((atual) => Math.min(linha.fimMs, atual + passou));
    }, 1000 / PASSOS_POR_SEGUNDO);
    return () => clearInterval(relogio);
  }, [andando, ritmo, linha.fimMs]);

  // O salão só muda de minuto em minuto: menos trabalho para o 3D a cada passo do relógio.
  const minuto = Math.floor(instante / MINUTO) * MINUTO;
  const salao = useMemo(() => salaoNoInstante(replay, minuto), [replay, minuto]);
  const travas = useMemo(() => travasPorMesa(replay), [replay]);
  const calor = useMemo(() => new Map(travas.map((t) => [t.mesaId, t.calor])), [travas]);
  const momentos = useMemo(() => momentosDaNoite(replay), [replay]);
  const idDaMesa = useMemo(() => new Map(replay.mesas.map((m) => [m.numero, m.id])), [replay]);
  const limite = replay.limite_alerta_seg;
  const mesaEscolhida = replay.mesas.find((m) => m.id === mesaAberta) ?? null;
  const com3DAberto = vista === "3d" && com3D;
  const total = linha.fimMs - linha.inicioMs;

  function assistir() {
    if (noFim) setInstante(linha.inicioMs);
    setTocando(!andando);
  }

  function irPara(ms: number, mesaNumero?: number) {
    setTocando(false);
    setInstante(Math.max(linha.inicioMs, Math.min(linha.fimMs, ms)));
    const mesaId = mesaNumero === undefined ? undefined : idDaMesa.get(mesaNumero);
    if (mesaId !== undefined) {
      setMesaAberta(mesaId);
      if (com3DAberto) setFoco((antes) => ({ mesaId, vez: (antes?.vez ?? 0) + 1 }));
    }
  }

  function mudarVista(nova: Vista) {
    setVista(nova);
    setFoco(null);
    guardarVista(nova);
  }

  return (
    <div className="flex flex-col gap-5" data-testid="replay" data-calor={comCalor ? "sim" : "nao"}>
      <section
        aria-label="Controles do replay"
        className="flex flex-col gap-4 rounded-2xl border border-linha bg-superficie p-4 md:p-5"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            type="button"
            onClick={assistir}
            className="inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-lg bg-tinta px-4 font-semibold text-fundo hover:opacity-90"
          >
            <span aria-hidden>{andando ? "❚❚" : "▶"}</span>
            {andando ? "Pausar" : noFim ? "Assistir de novo" : "Assistir"}
          </button>
          <p
            className="numeros font-placa text-5xl font-extrabold leading-none"
            data-testid="hora-replay"
          >
            {horaLocal(instante)}
          </p>
          <div
            role="group"
            aria-label="Velocidade"
            className="inline-flex rounded-lg border border-linha bg-fundo p-0.5"
          >
            {VELOCIDADES.map((v, i) => (
              <button
                key={v.rotulo}
                type="button"
                aria-pressed={velocidade === i}
                onClick={() => setVelocidade(i)}
                className={`min-h-9 rounded-md px-3 text-sm font-semibold ${
                  velocidade === i ? "bg-tinta text-fundo" : "text-tinta-suave hover:text-tinta"
                }`}
              >
                {v.rotulo}
              </button>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2 font-semibold sm:ml-auto">
            <input
              type="checkbox"
              checked={comCalor}
              onChange={(e) => setComCalor(e.target.checked)}
              className="size-5 accent-[var(--atrasada)]"
            />
            Mapa de calor
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <div className="relative h-3" aria-hidden>
            {momentos.map((m) => (
              <span
                key={`${m.ms}-${m.mesaNumero}`}
                className="absolute top-0 size-2.5 -translate-x-1/2 rotate-45 bg-atrasada"
                style={{ left: `${((m.ms - linha.inicioMs) / total) * 100}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            min={linha.inicioMs}
            max={linha.fimMs}
            step={MINUTO}
            value={instante}
            onChange={(e) => {
              setTocando(false);
              setInstante(Number(e.target.value));
            }}
            aria-label="Hora da noite"
            aria-valuetext={horaLocal(instante)}
            className="w-full accent-[var(--tinta)]"
          />
          <div className="flex justify-between text-xs text-tinta-suave">
            <span>{horaLocal(linha.inicioMs)}</span>
            <span>{horaLocal(linha.fimMs)}</span>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Salão no replay" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Contagem mesas={salao.mesas} agoraMs={instante} limiteSeg={limite} />
            {com3D && <SeletorVista vista={vista} aoMudar={mudarVista} />}
          </div>
          {com3DAberto ? (
            <LimiteDeErro
              reserva={null}
              aoFalhar={() => {
                setCom3D(false);
                setVista("planta");
              }}
            >
              <Salao3D
                mesas={salao.mesas}
                alertas={salao.alertas}
                foco={foco}
                agoraMs={instante}
                limiteSeg={limite}
                nome={nome}
                calor={comCalor ? calor : null}
                aoAbrir={setMesaAberta}
                aoFalhar={() => {
                  setCom3D(false);
                  setVista("planta");
                }}
              />
            </LimiteDeErro>
          ) : (
            <Planta mesas={salao.mesas}>
              {salao.mesas.map((m) => (
                <MesaNaPlanta
                  key={m.id}
                  mesa={m}
                  agoraMs={instante}
                  limiteSeg={limite}
                  aoAbrir={(alvo) => setMesaAberta(alvo.id)}
                  calor={
                    comCalor && (calor.get(m.id) ?? 0) >= CALOR_MINIMO ? calor.get(m.id) : undefined
                  }
                />
              ))}
            </Planta>
          )}
          {comCalor && (
            <p className="text-sm text-tinta-suave">
              Mapa de calor: quanto mais vermelho em volta da mesa, mais tempo ela ficou travada
              nessa noite (suja depois que o cliente saiu, ou com gente indo embora sem
              atendimento).
            </p>
          )}
          {mesaEscolhida && (
            <section
              aria-labelledby="titulo-mesa-replay"
              className="flex flex-col gap-2 rounded-xl border border-linha bg-superficie p-4"
              data-testid="linha-da-mesa"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="titulo-mesa-replay" className="font-placa text-2xl font-bold">
                  Mesa {mesaEscolhida.numero} nessa noite
                </h2>
                <button
                  type="button"
                  onClick={() => setMesaAberta(null)}
                  className="rounded-lg px-2 py-1 font-semibold text-tinta-suave hover:text-tinta"
                >
                  Fechar
                </button>
              </div>
              <ol className="flex flex-col gap-1">
                {linhaDaMesa(replay, mesaEscolhida.id).map((frase) => (
                  <li key={frase}>{frase}</li>
                ))}
                {linhaDaMesa(replay, mesaEscolhida.id).length === 0 && (
                  <li className="text-tinta-suave">Ninguém sentou nessa mesa.</li>
                )}
              </ol>
            </section>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <section aria-labelledby="titulo-momentos" className="flex flex-col gap-2">
            <h2 id="titulo-momentos" className="font-placa text-2xl font-bold">
              Momentos da noite
            </h2>
            {momentos.length === 0 ? (
              <p className="text-tinta-suave">Noite tranquila: nada que valha rever.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {momentos.map((m) => (
                  <li key={`${m.ms}-${m.mesaNumero}`}>
                    <button
                      type="button"
                      onClick={() => irPara(m.ms - 2 * MINUTO, m.mesaNumero)}
                      className="flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left hover:bg-superficie"
                    >
                      <span className="numeros font-semibold">{horaLocal(m.ms)}</span>
                      <span>{m.texto}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="titulo-travas" className="flex flex-col gap-2">
            <h2 id="titulo-travas" className="font-placa text-2xl font-bold">
              Onde o salão travou
            </h2>
            <ol className="flex flex-col divide-y divide-linha">
              {travas
                .filter((t) => t.calor > 0)
                .slice(0, 4)
                .map((t) => (
                  <li key={t.mesaId} className="flex items-baseline gap-3 py-2">
                    <span className="font-placa text-2xl font-extrabold">{t.numero}</span>
                    <span className="text-sm text-tinta-suave">
                      {Math.round(t.minutosSuja)} min suja
                      {t.foramEmbora > 0 &&
                        `, ${t.foramEmbora} ${t.foramEmbora === 1 ? "mesa foi embora" : "mesas foram embora"}`}
                    </span>
                  </li>
                ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
