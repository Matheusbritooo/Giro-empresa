"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import { urlAoVivo } from "./api";
import { aplicarMensagem, type EstadoSalao, SALAO_VAZIO } from "./salao";
import type { Alerta, MensagemAoVivo } from "./tipos";

export type Conexao = "conectando" | "ao_vivo" | "reconectando" | "sem_acesso";

const ESPERAS_RECONEXAO_MS = [1000, 2000, 5000, 10000];
const PING_MS = 25000;

function redutor(estado: EstadoSalao, mensagem: MensagemAoVivo): EstadoSalao {
  return aplicarMensagem(estado, mensagem);
}

/** Conecta no canal ao vivo do salão e mantém tudo atualizado, reconectando se cair. */
export function useSalaoAoVivo(
  restaurante: number | null,
  aoChegarAlerta: (alerta: Alerta) => void,
) {
  const [estado, despachar] = useReducer(redutor, SALAO_VAZIO);
  const [conexao, setConexao] = useState<Conexao>("conectando");
  const avisar = useRef(aoChegarAlerta);
  useEffect(() => {
    avisar.current = aoChegarAlerta;
  }, [aoChegarAlerta]);

  useEffect(() => {
    if (!restaurante) return; // equipe GIRO ainda não escolheu o restaurante
    let ws: WebSocket | null = null;
    let tentativa = 0;
    let encerrado = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const vistos = new Set<number>();

    function conectar() {
      ws = new WebSocket(urlAoVivo(restaurante));
      ws.onopen = () => {
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
      };
      ws.onmessage = (evento) => {
        const mensagem = JSON.parse(evento.data) as MensagemAoVivo;
        if (mensagem.tipo === "salao") {
          tentativa = 0;
          setConexao("ao_vivo");
          mensagem.salao.alertas.forEach((a) => vistos.add(a.id));
        } else if (mensagem.tipo === "alerta") {
          const { alerta } = mensagem;
          if (!alerta.resolvido_em && !vistos.has(alerta.id)) avisar.current(alerta);
          vistos.add(alerta.id);
        }
        despachar(mensagem);
      };
      ws.onclose = (evento) => {
        clearInterval(ping);
        if (encerrado) return;
        if (evento.code === 1008) {
          setConexao("sem_acesso");
          return;
        }
        setConexao("reconectando");
        const ms = ESPERAS_RECONEXAO_MS[Math.min(tentativa, ESPERAS_RECONEXAO_MS.length - 1)];
        tentativa += 1;
        espera = setTimeout(conectar, ms);
      };
    }

    conectar();
    return () => {
      encerrado = true;
      clearInterval(ping);
      clearTimeout(espera);
      ws?.close();
    };
  }, [restaurante]);

  return { estado, conexao };
}

/** Relógio que anda de segundo em segundo, já corrigido pelo horário do servidor. */
export function useRelogio(ajusteMs: number): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return agora + ajusteMs;
}
