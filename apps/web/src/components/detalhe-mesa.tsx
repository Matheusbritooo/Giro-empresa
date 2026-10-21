"use client";

import { useEffect, useRef } from "react";

import { horaCurta, minutosEntre, situacao } from "@/lib/salao";
import type { Mesa } from "@/lib/tipos";

import { Botao } from "./ui";

export function DetalheMesa({
  mesa,
  agoraMs,
  limiteSeg,
  aoFechar,
  aoLiberar,
}: {
  mesa: Mesa | null;
  agoraMs: number;
  limiteSeg: number;
  aoFechar: () => void;
  aoLiberar: (mesa: Mesa) => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (mesa && !dialogo.current?.open) dialogo.current?.showModal();
    if (!mesa && dialogo.current?.open) dialogo.current.close();
  }, [mesa]);

  const s = mesa ? situacao(mesa, agoraMs, limiteSeg) : null;

  return (
    <dialog
      ref={dialogo}
      onClose={aoFechar}
      aria-labelledby="titulo-mesa"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-superficie p-0 text-tinta shadow-xl"
    >
      {mesa && s && (
        <div className="flex flex-col gap-5 p-5">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 id="titulo-mesa" className="font-placa text-4xl font-extrabold leading-none">
                Mesa {mesa.numero}
              </h2>
              <p className="text-tinta-suave">
                {mesa.lugares} lugares, {s.rotulo.toLowerCase()}
              </p>
            </div>
            <Botao variante="secundario" onClick={aoFechar} aria-label="Fechar">
              Fechar
            </Botao>
          </header>

          {mesa.sentou_em ? (
            <ol className="flex flex-col gap-2 border-l-2 border-linha pl-4">
              <Marco hora={mesa.sentou_em} texto={`${pessoas(mesa.pessoas)} sentaram`} />
              {mesa.atendida_em ? (
                <Marco
                  hora={mesa.atendida_em}
                  texto={`Atendida em ${minutosEntre(mesa.sentou_em, mesa.atendida_em)} min`}
                />
              ) : (
                <li className="text-tinta-suave">
                  Esperando atendimento há {minutosEntre(mesa.sentou_em, agoraMs)} min
                </li>
              )}
              {mesa.saiu_em && (
                <Marco
                  hora={mesa.saiu_em}
                  texto={`Saíram depois de ${minutosEntre(mesa.sentou_em, mesa.saiu_em)} min`}
                />
              )}
              {mesa.saiu_em && (
                <li className="font-semibold">
                  Parada há {minutosEntre(mesa.saiu_em, agoraMs)} min esperando limpeza
                </li>
              )}
            </ol>
          ) : (
            <p className="text-tinta-suave">Ninguém na mesa agora.</p>
          )}

          {mesa.estado === "para_limpar" && (
            <Botao onClick={() => aoLiberar(mesa)} className="w-full text-lg">
              Liberar mesa {mesa.numero}
            </Botao>
          )}
        </div>
      )}
    </dialog>
  );
}

function Marco({ hora, texto }: { hora: string; texto: string }) {
  return (
    <li className="flex gap-3">
      <span className="numeros w-12 shrink-0 font-semibold">{horaCurta(hora)}</span>
      <span>{texto}</span>
    </li>
  );
}

function pessoas(n: number) {
  return n === 1 ? "1 pessoa" : `${n} pessoas`;
}
