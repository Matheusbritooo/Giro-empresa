"use client";

import { useState } from "react";

export interface Barra {
  chave: string;
  /** Embaixo da barra ("20h", "sex"). Vazio = sem rótulo (gráfico com muitas barras). */
  rotulo: string;
  valor: number;
  /** Primeira linha da dica e da tabela para leitor de tela ("20h: 82% das mesas ocupadas"). */
  texto: string;
  detalhe?: string;
  destaque?: boolean;
}

/**
 * Barras simples de uma série só, desenhadas com HTML (cabem em qualquer largura). A barra em
 * destaque ganha a cor forte e o valor escrito em cima; as outras ficam mais claras. Passar o
 * mouse ou usar as setas do teclado mostra a dica de cada barra, e uma tabela escondida
 * repete tudo para quem usa leitor de tela.
 */
export function GraficoBarras({
  titulo,
  descricao,
  barras,
  maximo,
  cor,
  valorDestaque,
  linhaGuia,
}: {
  titulo: string;
  descricao?: string;
  barras: Barra[];
  /** Topo do gráfico (100% da altura). */
  maximo: number;
  /** Cor da barra em destaque; as outras vão na mesma cor, mais clara. */
  cor: "ocupada" | "tinta";
  /** Texto escrito em cima da barra em destaque ("92%"). */
  valorDestaque?: string;
  /** Uma linha de referência no fundo, com o texto dela ("cheio: 75%"). */
  linhaGuia?: { valor: number; texto: string };
}) {
  const [ativa, setAtiva] = useState<number | null>(null);
  const topo = maximo > 0 ? maximo : 1;
  const corForte = cor === "ocupada" ? "var(--ocupada)" : "var(--tinta)";
  const corClara =
    cor === "ocupada"
      ? "color-mix(in srgb, var(--ocupada) 50%, var(--superficie))"
      : "color-mix(in srgb, var(--tinta-suave) 70%, var(--superficie))";
  const destaque = barras.findIndex((b) => b.destaque);
  const barraAtiva = ativa === null ? null : barras[ativa];

  function teclar(evento: React.KeyboardEvent) {
    if (barras.length === 0) return;
    const passo = { ArrowRight: 1, ArrowLeft: -1 }[evento.key];
    if (passo === undefined) return;
    evento.preventDefault();
    setAtiva((atual) => {
      const de = atual ?? (destaque >= 0 ? destaque : 0);
      return Math.min(barras.length - 1, Math.max(0, atual === null ? de : de + passo));
    });
  }

  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption>
        <h3 className="text-lg font-bold">{titulo}</h3>
        {descricao && <p className="text-sm text-tinta-suave">{descricao}</p>}
      </figcaption>

      <div
        role="img"
        aria-label={`${titulo}. Use as setas para ler cada barra.`}
        tabIndex={0}
        onKeyDown={teclar}
        onFocus={() => setAtiva((a) => a ?? (destaque >= 0 ? destaque : 0))}
        onBlur={() => setAtiva(null)}
        onMouseLeave={() => setAtiva(null)}
        className="relative rounded-md"
      >
        {/* Folga em cima para o valor da barra mais alta não encostar no texto do gráfico. */}
        <div className="relative mt-6 h-36 border-b border-linha">
          {linhaGuia && (
            <div
              aria-hidden
              className="absolute inset-x-0 border-t border-dashed border-linha"
              style={{ bottom: `${(linhaGuia.valor / topo) * 100}%` }}
            >
              <span className="absolute right-0 -translate-y-full pb-0.5 text-xs text-tinta-suave">
                {linhaGuia.texto}
              </span>
            </div>
          )}
          <div className="absolute inset-0 flex items-end gap-0.5">
            {barras.map((barra, i) => {
              const altura = Math.max(0, Math.min(1, barra.valor / topo)) * 100;
              const forte = barra.destaque || ativa === i;
              return (
                <div
                  key={barra.chave}
                  onMouseEnter={() => setAtiva(i)}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                >
                  {barra.destaque && valorDestaque && (
                    <span
                      className="absolute whitespace-nowrap text-sm font-bold text-tinta"
                      style={{ bottom: `calc(${altura}% + 2px)` }}
                    >
                      {valorDestaque}
                    </span>
                  )}
                  <div
                    className="w-full max-w-6 rounded-t-[4px] transition-[background-color]"
                    style={{
                      height: `${altura}%`,
                      minHeight: barra.valor > 0 ? 2 : 0,
                      background: forte ? corForte : corClara,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div aria-hidden className="flex gap-0.5 pt-1">
          {barras.map((barra) => (
            <span
              key={barra.chave}
              className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-xs text-tinta-suave"
            >
              {barra.rotulo}
            </span>
          ))}
        </div>

        {barraAtiva && ativa !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute -top-2 z-10 w-max max-w-56 -translate-x-1/2 -translate-y-full rounded-lg border border-linha bg-superficie px-3 py-2 text-sm shadow-lg"
            style={{
              left: `clamp(5rem, ${((ativa + 0.5) / barras.length) * 100}%, calc(100% - 5rem))`,
            }}
          >
            <p className="font-semibold text-tinta">{barraAtiva.texto}</p>
            {barraAtiva.detalhe && <p className="text-tinta-suave">{barraAtiva.detalhe}</p>}
          </div>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {barraAtiva ? `${barraAtiva.texto}. ${barraAtiva.detalhe ?? ""}` : ""}
      </p>
      {/* Tabela não aceita o sr-only direito (vaza para o lado no celular): vai dentro de uma div. */}
      <div className="sr-only">
        <table>
          <caption>{titulo}</caption>
          <tbody>
            {barras.map((barra) => (
              <tr key={barra.chave}>
                <td>{barra.texto}</td>
                <td>{barra.detalhe ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
