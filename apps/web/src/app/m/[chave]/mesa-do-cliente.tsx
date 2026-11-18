"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Marca } from "@/components/marca";
import { Aviso, Botao, Esqueleto } from "@/components/ui";
import { api } from "@/lib/api";
import { type Motivo, NOTAS, sugestoesDaCasa, textoDoBotao } from "@/lib/cliente";
import { useDados } from "@/lib/dados";
import { preco } from "@/lib/pedido";
import type { MesaPublica } from "@/lib/tipos";

const ATUALIZAR_MS = 30_000; // o que acabou na cozinha aparece sem recarregar

export function MesaDoCliente() {
  const { chave } = useParams<{ chave: string }>();
  const buscar = useCallback(() => api<MesaPublica>(`/api/publico/mesas/${chave}`), [chave]);
  const { dados: mesa, erro, recarregar } = useDados(buscar);
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState<Motivo | "nota" | null>(null);

  useEffect(() => {
    const id = setInterval(recarregar, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [recarregar]);

  async function chamar(motivo: Motivo) {
    setEnviando(motivo);
    try {
      const r = await api<{ texto: string }>(`/api/publico/mesas/${chave}/chamar`, {
        metodo: "POST",
        corpo: { motivo },
      });
      setRecado({ tipo: "ok", texto: r.texto });
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    } finally {
      setEnviando(null);
    }
  }

  async function avaliar(nota: number) {
    setEnviando("nota");
    try {
      const r = await api<{ texto: string }>(`/api/publico/mesas/${chave}/avaliar`, {
        metodo: "POST",
        corpo: { nota },
      });
      setRecado({ tipo: "ok", texto: r.texto });
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    } finally {
      setEnviando(null);
    }
  }

  if (!mesa) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Marca tamanho={28} />
        {erro ? <Aviso>{erro}</Aviso> : <Esqueleto linhas={5} rotulo="Abrindo o cardápio" />}
      </main>
    );
  }

  const sugestoes = sugestoesDaCasa(mesa);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-10">
      <header className="flex flex-col gap-1">
        <span className="font-semibold text-tinta-suave">{mesa.restaurante}</span>
        <h1 className="font-placa text-5xl font-extrabold leading-none">Mesa {mesa.mesa}</h1>
      </header>

      <section aria-label="Chamar a equipe" className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {(["garcom", "conta"] as const).map((motivo) => {
            const feito = mesa.chamados.includes(motivo);
            return (
              <Botao
                key={motivo}
                variante={motivo === "garcom" ? "principal" : "secundario"}
                className="min-h-14 text-lg"
                aria-pressed={feito}
                disabled={!mesa.com_clientes || feito || enviando !== null}
                onClick={() => chamar(motivo)}
              >
                {textoDoBotao(motivo, mesa.chamados)}
              </Botao>
            );
          })}
        </div>
        {!mesa.com_clientes && (
          <p className="text-sm text-tinta-suave">
            Os botões funcionam assim que a equipe vê a mesa ocupada. Acabou de sentar? Espere um
            instante.
          </p>
        )}
        {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      </section>

      {(sugestoes.length > 0 || mesa.destaques.length > 0) && (
        <section aria-labelledby="titulo-destaques" className="flex flex-col gap-2">
          <h2 id="titulo-destaques" className="font-placa text-2xl font-bold">
            Para escolher rápido
          </h2>
          <ul className="flex flex-wrap gap-2">
            {sugestoes.map((nome) => (
              <li
                key={`s-${nome}`}
                className="rounded-full border-2 border-ocupada px-3 py-1 font-semibold"
              >
                Sugestão de hoje: {nome}
              </li>
            ))}
            {mesa.destaques
              .filter((nome) => !sugestoes.includes(nome))
              .map((nome) => (
                <li key={`d-${nome}`} className="rounded-full border border-linha px-3 py-1">
                  Mais pedido: {nome}
                </li>
              ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="titulo-cardapio" className="flex flex-col gap-4">
        <h2 id="titulo-cardapio" className="font-placa text-2xl font-bold">
          Cardápio de hoje
        </h2>
        {mesa.categorias
          .filter((c) => c.itens.length > 0)
          .map((categoria) => (
            <div key={categoria.nome} className="flex flex-col gap-1">
              <h3 className="font-semibold text-tinta-suave">{categoria.nome}</h3>
              <ul className="flex flex-col divide-y divide-linha rounded-xl border border-linha bg-superficie px-3">
                {categoria.itens.map((item) => (
                  <li
                    key={item.nome}
                    className="flex items-baseline justify-between gap-3 py-2.5"
                    data-acabou={!item.disponivel || undefined}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span
                        className={
                          item.disponivel ? "font-semibold" : "text-tinta-suave line-through"
                        }
                      >
                        {item.nome}
                      </span>
                      {item.descricao && (
                        <span className="text-sm text-tinta-suave">{item.descricao}</span>
                      )}
                    </span>
                    <span className="numeros shrink-0 text-right">
                      {item.disponivel ? (
                        preco(item.preco_centavos)
                      ) : (
                        <span className="font-bold text-atrasada">Acabou hoje</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>

      <section aria-labelledby="titulo-nota" className="flex flex-col gap-2">
        <h2 id="titulo-nota" className="font-placa text-2xl font-bold">
          Como está sendo?
        </h2>
        <div role="group" aria-label="Sua nota" className="grid grid-cols-5 gap-2">
          {NOTAS.map(({ nota, texto }) => (
            <button
              key={nota}
              type="button"
              aria-pressed={mesa.nota === nota}
              disabled={enviando !== null}
              onClick={() => avaliar(nota)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl border font-semibold ${
                mesa.nota === nota
                  ? "border-tinta bg-tinta text-fundo"
                  : "border-linha bg-superficie text-tinta"
              }`}
            >
              <span className="numeros font-placa text-2xl font-extrabold leading-none">
                {nota}
              </span>
              <span className="text-xs">{texto}</span>
            </button>
          ))}
        </div>
      </section>

      <footer className="flex flex-col items-start gap-2 border-t border-linha pt-4 text-sm text-tinta-suave">
        <p>Esta página não pede seus dados e não guarda nada sobre você. A nota é da mesa.</p>
        <Marca tamanho={20} />
      </footer>
    </main>
  );
}
