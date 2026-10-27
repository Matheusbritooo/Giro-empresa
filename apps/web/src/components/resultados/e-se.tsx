"use client";

import { useEffect, useId, useState } from "react";

import { api } from "@/lib/api";
import { decimal, minutos, reais } from "@/lib/resultados";
import type { ResultadoCenario } from "@/lib/tipos";

/** Espera o dono parar de mexer antes de perguntar ao servidor. */
const ESPERA_MS = 350;

/**
 * "E se?": o dono mexe no tempo de limpeza e no número de garçons e vê quanto entraria a mais
 * por mês, com base nas últimas 4 semanas do próprio salão.
 */
export function ESe({ restaurante, dia }: { restaurante: number | null; dia: string }) {
  const [limpeza, setLimpeza] = useState(3);
  const [garconsHoje, setGarconsHoje] = useState(3);
  const [garconsCom, setGarconsCom] = useState(3);
  const [resposta, setResposta] = useState<{
    chave: string;
    resultado: ResultadoCenario | null;
    erro: string | null;
  } | null>(null);

  const chave = `${restaurante}:${dia}:${limpeza}:${garconsHoje}:${garconsCom}`;

  useEffect(() => {
    if (!restaurante) return;
    let ativo = true;
    const espera = setTimeout(() => {
      const busca = new URLSearchParams({
        periodo: "mes",
        dia,
        limpeza_max_min: String(limpeza),
      });
      if (garconsHoje !== garconsCom) {
        busca.set("garcons_atual", String(garconsHoje));
        busca.set("garcons_novo", String(garconsCom));
      }
      api<ResultadoCenario>(`/api/resultados/e-se?${busca}`, { restaurante }).then(
        (resultado) => ativo && setResposta({ chave, resultado, erro: null }),
        (e: Error) => ativo && setResposta({ chave, resultado: null, erro: e.message }),
      );
    }, ESPERA_MS);
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [restaurante, dia, limpeza, garconsHoje, garconsCom, chave]);

  const r = resposta?.resultado ?? null;
  const atualizando = resposta?.chave !== chave;
  const ganho = r?.ganho_mes_centavos ?? 0;
  const paradaHoje = r?.parada_media_atual_seg ?? null;

  return (
    <section
      aria-labelledby="titulo-e-se"
      className="flex flex-col gap-5 rounded-2xl border border-linha bg-superficie p-5 md:p-7"
    >
      <header className="max-w-prose">
        <h2 id="titulo-e-se" className="font-placa text-2xl font-bold">
          E se?
        </h2>
        <p className="text-tinta-suave">
          Mexa nos números e veja quanto entraria por mês, com base nas últimas 4 semanas do seu
          salão.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="e-se-limpeza" className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">Mesa limpa em até</span>
              <span className="numeros font-placa text-3xl font-extrabold">
                {decimal(limpeza, limpeza % 1 === 0 ? 0 : 1)} min
              </span>
            </label>
            <input
              id="e-se-limpeza"
              type="range"
              min={1}
              max={15}
              step={0.5}
              value={limpeza}
              onChange={(e) => setLimpeza(Number(e.target.value))}
              className="w-full accent-[var(--ocupada)]"
              aria-describedby="e-se-limpeza-hoje"
            />
            <p id="e-se-limpeza-hoje" className="text-sm text-tinta-suave">
              {paradaHoje === null
                ? "Arraste para escolher em quanto tempo a mesa fica pronta."
                : `Hoje a mesa fica ${minutos(paradaHoje)} parada depois que o cliente sai, em média.`}
            </p>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-semibold">Garçons no salão</legend>
            <div className="flex flex-wrap gap-6">
              <Contador rotulo="Hoje" valor={garconsHoje} aoMudar={setGarconsHoje} />
              <Contador rotulo="Com a mudança" valor={garconsCom} aoMudar={setGarconsCom} />
            </div>
          </fieldset>
        </div>

        <div
          aria-live="polite"
          aria-busy={atualizando}
          data-testid="resultado-e-se"
          className={`flex flex-col gap-3 rounded-xl bg-fundo p-5 transition-opacity ${atualizando ? "opacity-60" : ""}`}
        >
          {resposta?.erro ? (
            <p role="alert">{resposta.erro}</p>
          ) : !r ? (
            <p className="text-tinta-suave">Fazendo as contas...</p>
          ) : (
            <>
              <p className="text-lg">
                {ganho > 0
                  ? "Entraria a mais, por mês, cerca de"
                  : ganho < 0
                    ? "Deixaria de entrar, por mês, cerca de"
                    : "Com esses números, o mês ficaria igual."}
              </p>
              {ganho !== 0 && (
                <p className="numeros font-placa text-6xl font-extrabold leading-none">
                  {reais(Math.abs(ganho))}
                </p>
              )}
              <ul className="flex flex-col gap-1.5 text-sm">
                {r.turmas_a_mais > 0.05 && (
                  <li>
                    {decimal(r.turmas_a_mais)} grupos de clientes a mais em 4 semanas, com a mesa
                    pronta antes.
                  </li>
                )}
                {r.parada_media_nova_seg !== null &&
                  r.parada_media_atual_seg !== null &&
                  r.parada_media_nova_seg < r.parada_media_atual_seg && (
                    <li>
                      Mesa parada cai de {minutos(r.parada_media_atual_seg)} para{" "}
                      {minutos(r.parada_media_nova_seg)}.
                    </li>
                  )}
                {r.espera_media_nova_seg !== null &&
                  r.espera_media_atual_seg !== null &&
                  Math.round(r.espera_media_nova_seg) !== Math.round(r.espera_media_atual_seg) && (
                    <li>
                      Espera pelo garçom vai de {minutos(r.espera_media_atual_seg)} para{" "}
                      {minutos(r.espera_media_nova_seg)}.
                    </li>
                  )}
                {r.desistencias_evitadas > 0 && (
                  <li>
                    {r.desistencias_evitadas}{" "}
                    {r.desistencias_evitadas === 1
                      ? "mesa deixaria de ir embora"
                      : "mesas deixariam de ir embora"}{" "}
                    sem atendimento.
                  </li>
                )}
                {r.desistencias_novas > 0 && (
                  <li>
                    {r.desistencias_novas}{" "}
                    {r.desistencias_novas === 1 ? "mesa iria embora" : "mesas iriam embora"} sem
                    atendimento.
                  </li>
                )}
              </ul>
              <p className="text-xs text-tinta-suave">
                Conta aproximada: usa o ticket médio e o movimento real das últimas 4 semanas. Não
                inclui o salário de quem entra ou sai.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Contador({
  rotulo,
  valor,
  aoMudar,
}: {
  rotulo: string;
  valor: number;
  aoMudar: (valor: number) => void;
}) {
  const id = useId();
  const mudar = (novo: number) => aoMudar(Math.min(20, Math.max(1, novo)));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-tinta-suave" id={id}>
        {rotulo}
      </span>
      <div className="flex items-center gap-2" role="group" aria-labelledby={id}>
        <button
          type="button"
          onClick={() => mudar(valor - 1)}
          disabled={valor <= 1}
          aria-label={`Um garçom a menos (${rotulo.toLowerCase()})`}
          className="grid size-11 place-items-center rounded-lg border border-linha text-xl font-bold disabled:opacity-40"
        >
          −
        </button>
        <output
          className="numeros w-8 text-center font-placa text-3xl font-extrabold"
          aria-live="polite"
        >
          {valor}
        </output>
        <button
          type="button"
          onClick={() => mudar(valor + 1)}
          disabled={valor >= 20}
          aria-label={`Um garçom a mais (${rotulo.toLowerCase()})`}
          className="grid size-11 place-items-center rounded-lg border border-linha text-xl font-bold disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
