"use client";

import { useCallback, useState } from "react";

import { Botao } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import type { BriefingCopiloto, RespostaCopiloto } from "@/lib/tipos";

const SUGESTOES = [
  "Qual mesa mais me dá prejuízo?",
  "Que horas o salão lota?",
  "Quanto eu perdi nas últimas semanas?",
];

/** O Copiloto GIRO: o recado antes do turno e uma caixa para perguntar em português. */
export function Copiloto({ restaurante }: { restaurante: number | null }) {
  const buscar = useCallback(
    () => api<BriefingCopiloto>("/api/copiloto/briefing", { restaurante }),
    [restaurante],
  );
  const { dados: briefing, erro } = useDados(restaurante ? buscar : null);
  const [pergunta, setPergunta] = useState("");
  const [conversa, setConversa] = useState<{ pergunta: string; resposta: RespostaCopiloto }[]>([]);
  const [pensando, setPensando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  async function perguntar(texto: string) {
    const limpa = texto.trim();
    if (limpa.length < 3 || pensando) return;
    setPensando(true);
    setFalha(null);
    try {
      const resposta = await api<RespostaCopiloto>("/api/copiloto/perguntar", {
        metodo: "POST",
        restaurante,
        corpo: { pergunta: limpa },
      });
      setConversa((atual) => [...atual, { pergunta: limpa, resposta }].slice(-3));
      setPergunta("");
    } catch (e) {
      setFalha((e as Error).message);
    } finally {
      setPensando(false);
    }
  }

  return (
    <section
      aria-labelledby="titulo-copiloto"
      className="grid gap-5 rounded-2xl border border-linha bg-superficie p-5 md:grid-cols-[1.1fr_1fr] md:p-6"
    >
      <div className="flex flex-col gap-3">
        <h2 id="titulo-copiloto" className="font-placa text-2xl font-bold">
          Copiloto GIRO
        </h2>
        {erro && <p className="text-sm text-tinta-suave">{erro}</p>}
        {briefing ? (
          <>
            <p className="max-w-prose text-lg leading-relaxed">{briefing.frases.join(" ")}</p>
            <ul className="flex flex-col gap-2" aria-label="O que fazer hoje">
              {briefing.dicas.map((dica) => (
                <li key={dica} className="flex gap-2 font-semibold">
                  <span aria-hidden className="mt-2.5 h-0.5 w-3 shrink-0 rounded-full bg-tinta" />
                  {dica}
                </li>
              ))}
            </ul>
          </>
        ) : (
          !erro && <p className="text-tinta-suave">Lendo as últimas semanas...</p>
        )}
      </div>

      <div className="flex flex-col gap-3 md:border-l md:border-linha md:pl-6">
        <form
          className="flex flex-col gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            perguntar(pergunta);
          }}
        >
          <label htmlFor="pergunta-copiloto" className="font-semibold">
            Pergunte ao GIRO
          </label>
          <div className="flex gap-2">
            <input
              id="pergunta-copiloto"
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              maxLength={300}
              placeholder="Ex.: por que a sexta foi pior?"
              className="min-h-11 flex-1 rounded-lg border border-linha bg-fundo px-3 text-base"
            />
            <Botao type="submit" disabled={pensando || pergunta.trim().length < 3}>
              Perguntar
            </Botao>
          </div>
        </form>
        <div className="flex flex-wrap gap-2">
          {SUGESTOES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pensando}
              onClick={() => perguntar(s)}
              className="min-h-9 rounded-full border border-linha px-3 text-sm text-tinta-suave hover:border-tinta-suave hover:text-tinta disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <div aria-live="polite" className="flex flex-col gap-3" data-testid="respostas-copiloto">
          {pensando && <p className="text-tinta-suave">Olhando os números...</p>}
          {falha && (
            <p role="alert" className="text-sm">
              {falha}
            </p>
          )}
          {conversa
            .slice()
            .reverse()
            .map(({ pergunta: p, resposta }) => (
              <div key={p} className="rounded-xl bg-fundo p-3">
                <p className="text-sm text-tinta-suave">{p}</p>
                <p className="mt-1 leading-relaxed">{resposta.resposta}</p>
                <p className="mt-2 text-xs text-tinta-suave">
                  {resposta.fonte === "ia"
                    ? "Resposta da IA, só com os números do salão."
                    : "Resposta automática com os números do salão."}
                </p>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
