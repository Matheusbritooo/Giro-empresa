"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";

import { CodigoQr } from "@/components/codigo-qr";
import { Aviso, Botao, Esqueleto } from "@/components/ui";
import { api } from "@/lib/api";
import { enderecoDoQr } from "@/lib/cliente";
import { useDados } from "@/lib/dados";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { comBusca } from "@/lib/resultados";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import type { QrMesa } from "@/lib/tipos";

const semMudanca = () => () => {};

/** O QR de cada mesa, pronto para imprimir e deixar na mesa. */
export default function PaginaQrDasMesas() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
  const gestao = !!sessao && podeGerirMesas(sessao.usuario.papel);
  // O endereço do painel só existe no navegador (no servidor, a página fica sem QR).
  const origem = useSyncExternalStore(
    semMudanca,
    () => window.location.origin,
    () => "",
  );
  const buscar = useCallback(() => api<QrMesa[]>("/api/mesas/qr", { restaurante }), [restaurante]);
  const { dados: mesas, erro, recarregar } = useDados(restaurante && gestao ? buscar : null);
  const [trocando, setTrocando] = useState<number | null>(null);
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  if (sessao && !gestao) return <Aviso>Os QR das mesas ficam com o dono e o gerente.</Aviso>;

  async function trocar(mesa: QrMesa) {
    try {
      await api(`/api/mesas/${mesa.mesa_id}/qr/trocar`, { metodo: "POST" });
      setTrocando(null);
      setRecado({
        tipo: "ok",
        texto: `QR da mesa ${mesa.numero} trocado. Imprima de novo: o antigo não abre mais.`,
      });
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  const nome = sessao?.restaurante?.nome ?? "";
  return (
    <>
      <div className="flex flex-col gap-2 print:hidden">
        <Link
          href={comBusca("/mesas", parametros, {})}
          className="self-start font-semibold text-tinta-suave hover:text-tinta"
        >
          <span aria-hidden>‹ </span>Mesas
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-placa text-4xl font-extrabold leading-none">QR das mesas</h1>
          <Botao onClick={() => window.print()} disabled={!mesas?.length}>
            Imprimir
          </Botao>
        </header>
        <p className="max-w-prose text-tinta-suave">
          Deixe o QR de cada mesa à vista. O cliente aponta a câmera do celular e vê o cardápio de
          hoje, chama o garçom, pede a conta e dá uma nota. Não precisa baixar nada nem se
          cadastrar.
        </p>
        {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
        <Aviso>{erro}</Aviso>
      </div>

      {!mesas || !origem ? (
        !erro && <Esqueleto formato="cartoes" linhas={6} rotulo="Montando os QR" />
      ) : mesas.length === 0 ? (
        <p className="text-tinta-suave">Nenhuma mesa ativa. Cadastre as mesas primeiro.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3 print:gap-6">
          {mesas.map((mesa) => (
            <li
              key={mesa.mesa_id}
              data-testid={`qr-mesa-${mesa.numero}`}
              className="flex break-inside-avoid flex-col items-center gap-2 rounded-2xl border border-linha bg-superficie p-4 text-center print:border-black"
            >
              <span className="text-sm text-tinta-suave print:text-black">{nome}</span>
              <span className="font-placa text-4xl font-extrabold leading-none">
                Mesa {mesa.numero}
              </span>
              <div className="w-full max-w-48 rounded-lg bg-white p-1">
                <CodigoQr
                  texto={enderecoDoQr(origem, mesa.chave)}
                  rotulo={`QR da mesa ${mesa.numero}`}
                />
              </div>
              <span className="text-sm leading-snug">
                Aponte a câmera: cardápio, chamar o garçom e pedir a conta.
              </span>
              <div className="print:hidden">
                {trocando === mesa.mesa_id ? (
                  <span className="flex flex-col items-center gap-2">
                    <span className="text-sm text-tinta-suave">
                      O QR impresso desta mesa para de funcionar.
                    </span>
                    <span className="flex flex-wrap justify-center gap-2">
                      <Botao variante="perigo" onClick={() => trocar(mesa)}>
                        Trocar QR
                      </Botao>
                      <Botao variante="secundario" onClick={() => setTrocando(null)}>
                        Voltar
                      </Botao>
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTrocando(mesa.mesa_id)}
                    className="min-h-9 text-sm font-semibold text-tinta-suave underline underline-offset-2"
                  >
                    Trocar QR da mesa {mesa.numero}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
