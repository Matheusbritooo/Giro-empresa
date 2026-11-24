"use client";

import Link from "next/link";
import { useCallback } from "react";

import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { usePassosOcultos } from "@/lib/passos";
import type { PrimeirosPassos as Passos } from "@/lib/tipos";

/** O que falta para o GIRO trabalhar, na tela Hoje. Some quando tudo está pronto. */
export function PrimeirosPassos({
  restaurante,
  link,
}: {
  restaurante: number;
  link: (href: string) => string;
}) {
  const buscar = useCallback(
    () => api<Passos>("/api/primeiros-passos", { restaurante }),
    [restaurante],
  );
  const { dados } = useDados(buscar, `passos:${restaurante}`);
  const [ocultos, ocultar] = usePassosOcultos(restaurante);

  if (!dados || !dados.novo || dados.feitos === dados.total || ocultos) return null;
  const proximo = dados.passos.find((p) => !p.feito)?.id;

  return (
    <section
      aria-labelledby="titulo-passos"
      className="flex flex-col gap-3 rounded-xl border border-linha bg-superficie p-4"
      data-testid="primeiros-passos"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-passos" className="font-placa text-2xl font-bold">
          Primeiros passos
        </h2>
        <span className="font-semibold text-tinta-suave">
          {dados.feitos} de {dados.total} prontos
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-fundo"
        role="progressbar"
        aria-label="Primeiros passos prontos"
        aria-valuemin={0}
        aria-valuemax={dados.total}
        aria-valuenow={dados.feitos}
      >
        <div
          className="h-full rounded-full bg-ocupada"
          style={{ width: `${(dados.feitos / dados.total) * 100}%` }}
        />
      </div>
      <ol className="flex flex-col divide-y divide-linha">
        {dados.passos.map((p) => (
          <li
            key={p.id}
            data-passo={p.id}
            data-feito={p.feito ? "sim" : "nao"}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
          >
            <span
              aria-hidden
              className={`grid size-6 shrink-0 place-items-center rounded-full border-2 text-sm font-bold ${
                p.feito ? "border-ocupada bg-ocupada text-fundo" : "border-linha"
              }`}
            >
              {p.feito ? "✓" : ""}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className={p.feito ? "text-tinta-suave line-through" : "font-semibold"}>
                {p.titulo}
                <span className="sr-only">{p.feito ? ": pronto" : ": falta"}</span>
              </span>
              {!p.feito && <span className="text-sm text-tinta-suave">{p.porque}</span>}
            </div>
            {!p.feito &&
              (p.href ? (
                <Link
                  href={link(p.href)}
                  aria-label={`${p.id === proximo ? "Fazer agora" : "Fazer"}: ${p.titulo}`}
                  className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold ${
                    p.id === proximo
                      ? "bg-tinta text-fundo"
                      : "border border-linha hover:border-tinta-suave"
                  }`}
                >
                  {p.id === proximo ? "Fazer agora" : "Fazer"}
                </Link>
              ) : (
                <span className="text-sm text-tinta-suave">O dono faz</span>
              ))}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => ocultar(true)}
        className="self-start text-sm font-semibold text-tinta-suave underline underline-offset-2 hover:text-tinta"
      >
        Esconder neste aparelho
      </button>
    </section>
  );
}
