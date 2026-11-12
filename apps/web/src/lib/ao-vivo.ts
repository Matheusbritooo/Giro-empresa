"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import { urlAoVivo } from "./api";
import { dadoGuardado, guardarDado } from "./dados";
import { aplicarMensagem, type EstadoSalao, SALAO_VAZIO } from "./salao";
import type { Alerta, AvisoAoVivo, MensagemAoVivo } from "./tipos";

export type Conexao = "conectando" | "ao_vivo" | "reconectando" | "sem_acesso";

const ESPERAS_RECONEXAO_MS = [1000, 2000, 5000, 10000];
const PING_MS = 25000;

function redutor(estado: EstadoSalao, mensagem: MensagemAoVivo): EstadoSalao {
  return aplicarMensagem(estado, mensagem);
}

/** Onde o último salão visto fica guardado: a tela abre com ele enquanto o canal conecta, e o
 * pedido sem internet tira daqui o número da mesa. */
export function chaveDoSalao(restaurante: number): string {
  return `salao:${restaurante}`;
}

function salaoInicial(restaurante: number | null): EstadoSalao {
  return (restaurante && dadoGuardado<EstadoSalao>(chaveDoSalao(restaurante))) || SALAO_VAZIO;
}

/** Conecta no canal ao vivo do salão e mantém tudo atualizado, reconectando se cair. */
export function useSalaoAoVivo(
  restaurante: number | null,
  aoChegarAlerta: (alerta: Alerta) => void,
  aoAviso?: (aviso: AvisoAoVivo) => void,
) {
  const [estado, despachar] = useReducer(redutor, restaurante, salaoInicial);
  const [conexao, setConexao] = useState<Conexao>("conectando");
  useEffect(() => {
    if (restaurante && estado.salao) guardarDado(chaveDoSalao(restaurante), estado);
  }, [restaurante, estado]);
  const avisar = useRef(aoChegarAlerta);
  const avisarOutros = useRef(aoAviso);
  useEffect(() => {
    avisar.current = aoChegarAlerta;
    avisarOutros.current = aoAviso;
  }, [aoChegarAlerta, aoAviso]);

  useEffect(() => {
    if (!restaurante) return; // equipe GIRO ainda não escolheu o restaurante
    let ws: WebSocket | null = null;
    let tentativa = 0;
    let encerrado = false;
    let jaConectou = false;
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
          // O canal voltou depois de cair: quem tem lista na tela busca de novo, porque os
          // avisos desse meio tempo se perderam (o pedido que subiu da fila, por exemplo).
          if (jaConectou) avisarOutros.current?.({ tipo: "reconectou" });
          jaConectou = true;
          tentativa = 0;
          setConexao("ao_vivo");
          mensagem.salao.alertas.forEach((a) => vistos.add(a.id));
        } else if (
          mensagem.tipo === "pedido" ||
          mensagem.tipo === "cardapio" ||
          mensagem.tipo === "estoque"
        ) {
          avisarOutros.current?.(mensagem);
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
