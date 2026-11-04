"use client";

import { useCallback, useState } from "react";

import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { reais } from "@/lib/resultados";
import type { Periodo, ResultadosCardapio } from "@/lib/tipos";

import { quando } from "./numeros";

const DO_PERIODO: Record<Periodo, string> = {
  noite: "da noite",
  semana: "da semana",
  mes: "do mês",
};

/** O que saiu da cozinha no período: prato e bebida campeões e o que cada mesa mais pediu. */
export function CardapioDoPeriodo({
  restaurante,
  periodo,
  dia,
}: {
  restaurante: number;
  periodo: Periodo;
  dia: string;
}) {
  const buscar = useCallback(
    () =>
      api<ResultadosCardapio>(`/api/resultados/cardapio?periodo=${periodo}&dia=${dia}`, {
        restaurante,
      }),
    [restaurante, periodo, dia],
  );
  const { dados, erro } = useDados(buscar);
  const [lista, setLista] = useState<"comida" | "bebida">("comida");

  if (erro) return <p className="text-sm text-tinta-suave">{erro}</p>;
  if (!dados) return null;

  const comida = dados.itens.filter((i) => !i.bebida);
  const bebidas = dados.itens.filter((i) => i.bebida);
  const prato = comida[0];
  const bebida = bebidas[0];
  const top = (lista === "comida" ? comida : bebidas).slice(0, 8);
  const maior = top[0]?.quantidade ?? 1;
  const mesaQueMaisVendeu = dados.mesas.reduce<(typeof dados.mesas)[number] | null>(
    (melhor, m) => (melhor === null || m.total_centavos > melhor.total_centavos ? m : melhor),
    null,
  );

  return (
    <section
      aria-labelledby="titulo-cardapio-periodo"
      data-testid="cardapio-periodo"
      className="flex flex-col gap-6 rounded-2xl border border-linha bg-superficie p-5 md:p-7"
    >
      <header className="flex flex-col gap-1">
        <h2 id="titulo-cardapio-periodo" className="font-placa text-2xl font-bold">
          O que saiu da cozinha
        </h2>
        <p className="text-tinta-suave">
          {quando(periodo, dia)}, pelos pedidos lançados nas mesas.
        </p>
      </header>

      {dados.visitas_com_pedido === 0 ? (
        <p className="max-w-prose">
          Nenhum pedido lançado nesse período. Os pedidos que o garçom lança na mesa aparecem aqui.
        </p>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
            <div className="flex flex-col gap-1">
              <span className="text-tinta-suave">Prato {DO_PERIODO[periodo]}</span>
              <span
                className="font-placa text-5xl font-extrabold leading-none"
                data-testid="prato-do-periodo"
              >
                {prato?.nome ?? "–"}
              </span>
              {prato && (
                <span className="numeros">
                  <b>{prato.quantidade} pedidos</b>, {reais(prato.receita_centavos)} vendidos
                </span>
              )}
            </div>
            <dl className="numeros grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-linha bg-linha">
              <Numero titulo="Vendido" valor={reais(dados.faturamento_centavos)}>
                {dados.visitas_com_pedido} {dados.visitas_com_pedido === 1 ? "mesa" : "mesas"}
              </Numero>
              <Numero
                titulo="Ticket real por pessoa"
                valor={
                  dados.ticket_real_centavos === null ? "–" : reais(dados.ticket_real_centavos)
                }
              >
                {dados.ticket_real_centavos === null
                  ? "poucas mesas ainda"
                  : "o que cada um gastou"}
              </Numero>
              <Numero titulo={`Bebida ${DO_PERIODO[periodo]}`} valor={bebida?.nome ?? "–"} pequeno>
                {bebida ? `${bebida.quantidade} pedidas` : ""}
              </Numero>
              <Numero
                titulo="Mesa que mais vendeu"
                valor={mesaQueMaisVendeu ? `Mesa ${mesaQueMaisVendeu.numero}` : "–"}
                pequeno
              >
                {mesaQueMaisVendeu ? reais(mesaQueMaisVendeu.total_centavos) : ""}
              </Numero>
            </dl>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Mais pedidos</h3>
              <div role="group" aria-label="Mostrar" className="flex gap-2">
                {(["comida", "bebida"] as const).map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    aria-pressed={lista === tipo}
                    onClick={() => setLista(tipo)}
                    className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${
                      lista === tipo
                        ? "border-tinta bg-fundo text-tinta"
                        : "border-linha text-tinta-suave"
                    }`}
                  >
                    {tipo === "comida" ? "Comida" : "Bebida"}
                  </button>
                ))}
              </div>
            </div>
            {top.length === 0 ? (
              <p className="text-tinta-suave">Nenhuma {lista} pedida no período.</p>
            ) : (
              <ol
                className="numeros flex flex-col gap-2"
                aria-label={`${lista === "comida" ? "Comidas" : "Bebidas"} mais pedidas, em quantidade`}
              >
                {top.map((item, k) => (
                  <li
                    key={item.item_id}
                    className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3ch] items-center gap-3 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4ch]"
                  >
                    <span className={`truncate ${k === 0 ? "font-bold" : ""}`} title={item.nome}>
                      {item.nome}
                    </span>
                    <span aria-hidden className="flex h-4 items-center">
                      <span
                        className={`h-3.5 rounded-r-[4px] ${k === 0 ? "bg-tinta" : "bg-tinta-suave/50"}`}
                        style={{ width: `${Math.max(2, (item.quantidade / maior) * 100)}%` }}
                      />
                    </span>
                    <span className="text-right font-semibold">{item.quantidade}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-bold">O que cada mesa mais pediu</h3>
            <div className="overflow-x-auto rounded-xl border border-linha">
              <table className="numeros w-full min-w-[36rem] text-left text-sm">
                <thead className="border-b border-linha text-tinta-suave">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Mesa
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">
                      Visitas
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Comida favorita
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Bebida favorita
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">
                      Vendido
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {dados.mesas.map((m) => (
                    <tr key={m.numero} className={m === mesaQueMaisVendeu ? "bg-fundo" : ""}>
                      <th scope="row" className="px-4 py-2 font-placa text-2xl font-extrabold">
                        {m.numero}
                      </th>
                      <td className="px-4 py-2 text-right">{m.visitas}</td>
                      <td className="px-4 py-2">
                        {m.prato ?? "–"}
                        {m.prato && (
                          <span className="text-tinta-suave"> ({m.prato_quantidade})</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {m.bebida ?? "–"}
                        {m.bebida && (
                          <span className="text-tinta-suave"> ({m.bebida_quantidade})</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-bold">{reais(m.total_centavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Numero({
  titulo,
  valor,
  pequeno = false,
  children,
}: {
  titulo: string;
  valor: string;
  pequeno?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-superficie p-3">
      <dt className="text-xs font-semibold text-tinta-suave">{titulo}</dt>
      <dd className={`font-placa font-extrabold leading-tight ${pequeno ? "text-xl" : "text-3xl"}`}>
        {valor}
      </dd>
      <dd className="text-xs text-tinta-suave">{children}</dd>
    </div>
  );
}
