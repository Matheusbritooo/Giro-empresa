"use client";

import { textoAlerta, tempoDecorrido } from "@/lib/salao";
import type { Alerta } from "@/lib/tipos";

import { Botao } from "./ui";

export function ListaAlertas({
  alertas,
  agoraMs,
  aoReconhecer,
  aoLiberar,
  aoVerNoSalao,
}: {
  alertas: Alerta[];
  agoraMs: number;
  aoReconhecer: (alerta: Alerta) => void;
  aoLiberar: (alerta: Alerta) => void;
  /** Só com o salão em 3D aberto: leva a câmera do 3D até a mesa do alerta. */
  aoVerNoSalao?: (alerta: Alerta) => void;
}) {
  if (alertas.length === 0) {
    return (
      <p className="rounded-xl border border-linha px-4 py-3 text-tinta-suave" role="status">
        Nenhuma mesa precisa de você agora.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Mesas que precisam de atenção">
      {alertas.map((alerta) => {
        const atendimento = alerta.tipo === "sem_atendimento";
        return (
          <li
            key={alerta.id}
            data-testid={`alerta-${alerta.tipo}-${alerta.mesa_numero}`}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-l-[6px] bg-superficie py-2.5 pl-3 pr-2 ${
              atendimento ? "border-atrasada" : "border-limpar"
            }`}
          >
            <span className="font-placa text-3xl font-extrabold leading-none" aria-hidden>
              {alerta.mesa_numero}
            </span>
            <span className="flex min-w-[8rem] flex-1 flex-col leading-snug">
              <span className="font-semibold">{textoAlerta(alerta)}</span>
              <span className="numeros text-sm text-tinta-suave">
                há {tempoDecorrido(alerta.criado_em, agoraMs)}
                {atendimento && alerta.reconhecido_em && ", alguém já está indo"}
              </span>
            </span>
            <span className="ml-auto flex flex-wrap justify-end gap-2">
              {aoVerNoSalao && (
                <Botao
                  variante="secundario"
                  className="px-3 text-sm"
                  // Começa pelo texto visível (quem usa comando de voz fala o que vê).
                  aria-label={`Ver no salão a mesa ${alerta.mesa_numero}`}
                  onClick={() => aoVerNoSalao(alerta)}
                >
                  Ver no salão
                </Botao>
              )}
              {atendimento ? (
                !alerta.reconhecido_em && (
                  <Botao variante="secundario" onClick={() => aoReconhecer(alerta)}>
                    Vou atender
                  </Botao>
                )
              ) : (
                <Botao onClick={() => aoLiberar(alerta)}>Liberar mesa</Botao>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
