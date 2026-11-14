"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useRelogio } from "@/lib/ao-vivo";
import { api, ErroApi } from "@/lib/api";
import { marcarConexao, useConexao } from "@/lib/conexao";
import {
  avisarEnvio,
  filaAtual,
  filaNoServidor,
  foiRecusado,
  haQuanto,
  marcarRecusado,
  ouvirFila,
  paraConfirmar,
  paraEnviar,
  type PedidoNaFila,
  recusados,
  renovar,
  textoDaFila,
  tirarDaFila,
} from "@/lib/fila-pedidos";

const TENTAR_DE_NOVO_MS = 5000;

/** A fila de pedidos deste aparelho, sempre atual. */
export function useFilaDePedidos(): PedidoNaFila[] {
  return useSyncExternalStore(ouvirFila, filaAtual, filaNoServidor);
}

/**
 * Fica logo abaixo do menu, em toda tela. Avisa quando o painel está sem conexão, manda os
 * pedidos guardados assim que a rede volta e mostra os que precisam de uma decisão do garçom
 * (recusados pelo servidor ou guardados há tempo demais).
 */
export function FaixaDeConexao({ usuarioId, sufixo }: { usuarioId: number; sufixo: string }) {
  const ligada = useConexao();
  const fila = useFilaDePedidos();
  const agora = useRelogio(0);
  const [enviado, setEnviado] = useState<string | null>(null);
  const enviando = useRef(false);

  const enviar = useCallback(async () => {
    if (enviando.current) return;
    enviando.current = true;
    try {
      for (const pedido of paraEnviar(filaAtual(), usuarioId, Date.now())) {
        try {
          await api(`/api/mesas/${pedido.mesaId}/pedidos`, {
            metodo: "POST",
            corpo: {
              chave: pedido.chave,
              itens: pedido.itens.map(({ item_id, quantidade, observacao }) => ({
                item_id,
                quantidade,
                observacao,
              })),
            },
          });
          tirarDaFila(pedido.chave);
          avisarEnvio(pedido.mesaId);
          setEnviado(`Pedido da mesa ${pedido.mesaNumero} enviado.`);
        } catch (e) {
          if (e instanceof ErroApi && foiRecusado(e.status)) {
            marcarRecusado(pedido.chave, e.message);
          } else break; // sem rede ou servidor fora do ar: tenta de novo daqui a pouco
        }
      }
    } finally {
      enviando.current = false;
    }
  }, [usuarioId]);

  const esperando = paraEnviar(fila, usuarioId, agora);
  const velhos = paraConfirmar(fila, usuarioId, agora);
  const naoEntraram = recusados(fila, usuarioId);
  const temFila = esperando.length > 0;

  // Com pedido na fila, tenta mandar agora, de tempos em tempos e quando o aparelho avisa que
  // a rede voltou.
  useEffect(() => {
    if (!temFila) return;
    enviar();
    const id = setInterval(enviar, TENTAR_DE_NOVO_MS);
    window.addEventListener("online", enviar);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", enviar);
    };
  }, [temFila, enviar]);

  // Sem conexão e sem nada na fila, alguém precisa perguntar ao servidor se a rede voltou.
  useEffect(() => {
    const caiu = () => marcarConexao(false);
    window.addEventListener("offline", caiu);
    if (ligada) return () => window.removeEventListener("offline", caiu);
    const perguntar = () => api("/api/saude").catch(() => undefined);
    const id = setInterval(perguntar, TENTAR_DE_NOVO_MS);
    window.addEventListener("online", perguntar);
    return () => {
      clearInterval(id);
      window.removeEventListener("offline", caiu);
      window.removeEventListener("online", perguntar);
    };
  }, [ligada]);

  useEffect(() => {
    if (!enviado) return;
    const id = setTimeout(() => setEnviado(null), 6000);
    return () => clearTimeout(id);
  }, [enviado]);

  if (ligada && !temFila && !velhos.length && !naoEntraram.length && !enviado) return null;

  return (
    <div className="border-b border-linha bg-superficie" data-testid="faixa-conexao">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2 text-sm">
        {(!ligada || temFila) && (
          <p role="status" className="flex items-center gap-2 font-semibold">
            <span
              aria-hidden
              className={`size-2.5 shrink-0 rounded-full ${ligada ? "bg-ocupada" : "bg-aguardando"}`}
            />
            {!ligada && temFila
              ? `Sem conexão. ${textoDaFila(esperando.length)}: ${
                  esperando.length === 1 ? "sobe sozinho" : "sobem sozinhos"
                } quando a rede voltar.`
              : !ligada
                ? "Sem conexão. Pode lançar pedido: ele fica guardado e sobe quando a rede voltar."
                : `Enviando ${textoDaFila(esperando.length)}...`}
          </p>
        )}
        {enviado && ligada && !temFila && (
          <p role="status" className="font-semibold">
            {enviado}
          </p>
        )}
        {naoEntraram.map((pedido) => (
          <Decisao
            key={pedido.chave}
            texto={`O pedido da mesa ${pedido.mesaNumero} não entrou: ${pedido.recusado}.`}
          >
            <Link
              href={`/pedido?mesa=${pedido.mesaId}${sufixo}`}
              className="font-semibold underline underline-offset-2"
            >
              Abrir a mesa {pedido.mesaNumero}
            </Link>
            <BotaoDeTexto onClick={() => tirarDaFila(pedido.chave)}>Descartar</BotaoDeTexto>
          </Decisao>
        ))}
        {velhos.map((pedido) => (
          <Decisao
            key={pedido.chave}
            texto={`O pedido da mesa ${pedido.mesaNumero} está guardado ${haQuanto(pedido.guardadoEm, agora)} e não subiu sozinho. Ainda vale?`}
          >
            <BotaoDeTexto
              onClick={() => {
                renovar(pedido.chave, Date.now());
                enviar();
              }}
            >
              Enviar agora
            </BotaoDeTexto>
            <BotaoDeTexto onClick={() => tirarDaFila(pedido.chave)}>Descartar</BotaoDeTexto>
          </Decisao>
        ))}
      </div>
    </div>
  );
}

function Decisao({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border-l-4 border-atrasada bg-fundo px-3 py-2"
    >
      <span className="min-w-0 flex-1 basis-64">{texto}</span>
      <span className="flex gap-4">{children}</span>
    </div>
  );
}

function BotaoDeTexto({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-9 font-semibold underline underline-offset-2"
    >
      {children}
    </button>
  );
}
