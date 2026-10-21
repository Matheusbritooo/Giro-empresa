"use client";

import { textoAlerta, tempoDecorrido } from "@/lib/salao";
import type { Alerta } from "@/lib/tipos";

import { Botao } from "./ui";

export function ListaAlertas({
  alertas,
  agoraMs,
  aoReconhecer,
  aoLiberar,
}: {
  alertas: Alerta[];
  agoraMs: number;
  aoReconhecer: (alerta: Alerta) => void;
  aoLiberar: (alerta: Alerta) => void;
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
            className={`flex items-center gap-3 rounded-xl border-l-[6px] bg-superficie py-2.5 pl-3 pr-2 ${
              atendimento ? "border-atrasada" : "border-limpar"
            }`}
          >
            <span className="font-placa text-3xl font-extrabold leading-none" aria-hidden>
              {alerta.mesa_numero}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-snug">
              <span className="font-semibold">{textoAlerta(alerta)}</span>
              <span className="numeros text-sm text-tinta-suave">
                há {tempoDecorrido(alerta.criado_em, agoraMs)}
                {atendimento && alerta.reconhecido_em && ", alguém já está indo"}
              </span>
            </span>
            {atendimento ? (
              !alerta.reconhecido_em && (
                <Botao variante="secundario" onClick={() => aoReconhecer(alerta)}>
                  Vou atender
                </Botao>
              )
            ) : (
              <Botao onClick={() => aoLiberar(alerta)}>Liberar mesa</Botao>
            )}
          </li>
        );
      })}
    </ul>
  );
}
