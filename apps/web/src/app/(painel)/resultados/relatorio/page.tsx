"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { Aviso, Esqueleto } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import {
  chaveDoMes,
  mesEscolhido,
  nomeDaPlanilha,
  nomeDoMes,
  planilhaDoMes,
  ultimosMeses,
  comparadoCom,
  variacao,
} from "@/lib/relatorio";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { comBusca, decimal, diaDaSemana, minutos, noitePadrao, reais } from "@/lib/resultados";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import type { RelatorioDoMes } from "@/lib/tipos";

function baixar(texto: string, nome: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

function diaMes(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

/** O relatório do mês: para imprimir (ou salvar em PDF) e baixar como planilha. */
export default function PaginaRelatorio() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
  const caminho = usePathname();
  const router = useRouter();
  const gestao = !!sessao && podeGerirMesas(sessao.usuario.papel);
  const [hoje] = useState(() => noitePadrao(Date.now(), sessao?.restaurante?.abre_as ?? "18:00"));
  const meses = ultimosMeses(hoje, 12);
  const mes = mesEscolhido(parametros.get("mes"), hoje);
  const buscar = useCallback(
    () => api<RelatorioDoMes>(`/api/relatorios/mes?mes=${mes}`, { restaurante }),
    [mes, restaurante],
  );
  const { dados: r, erro } = useDados(
    restaurante && gestao ? buscar : null,
    `relatorio:${restaurante}:${mes}`,
  );

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  if (sessao && !gestao) return <Aviso>O relatório do mês fica com o dono e o gerente.</Aviso>;

  return (
    <>
      <div className="flex flex-col gap-3 print:hidden">
        <Link
          href={comBusca("/resultados", parametros, { mes: null })}
          className="self-start font-semibold text-tinta-suave hover:text-tinta"
        >
          <span aria-hidden>‹ </span>Resultados
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-placa text-4xl font-extrabold leading-none">Relatório do mês</h1>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Mês
              <select
                value={mes}
                onChange={(e) =>
                  router.replace(comBusca(caminho, parametros, { mes: e.target.value }), {
                    scroll: false,
                  })
                }
                className="min-h-11 rounded-lg border border-linha bg-superficie px-3 text-base font-normal"
              >
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {nomeDoMes(m)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!r}
              className="inline-flex min-h-11 items-center rounded-lg bg-tinta px-4 font-semibold text-fundo disabled:opacity-50"
            >
              Salvar em PDF
            </button>
            <button
              type="button"
              onClick={() => r && baixar(planilhaDoMes(r), nomeDaPlanilha(r.restaurante, r.mes))}
              disabled={!r}
              className="inline-flex min-h-11 items-center rounded-lg border border-linha bg-superficie px-4 font-semibold disabled:opacity-50"
            >
              Baixar planilha
            </button>
          </div>
        </header>
        <p className="max-w-prose text-sm text-tinta-suave">
          Em “Salvar em PDF”, escolha “Salvar como PDF” no lugar da impressora. A planilha abre no
          Excel e no Google Planilhas, com uma linha por noite.
        </p>
        <Aviso>{erro}</Aviso>
      </div>

      {!r || chaveDoMes(r.mes) !== mes ? (
        !erro && <Esqueleto formato="cartoes" linhas={8} rotulo="Montando o relatório" />
      ) : (
        <Folha r={r} />
      )}
    </>
  );
}

function Folha({ r }: { r: RelatorioDoMes }) {
  const comparado = comparadoCom(r);
  const compara = (atual: number, antes: number) => {
    const v = comparado ? variacao(atual, antes) : null;
    return v ? `${v} ${comparado}` : null;
  };
  const vendeu = compara(r.vendeu_centavos, r.vendeu_antes_centavos);
  const mesas = compara(r.mesas_atendidas, r.mesas_atendidas_antes);
  const ficou = compara(r.ficou_na_mesa_centavos, r.ficou_na_mesa_antes_centavos);
  const pct = (parte: number) =>
    r.vendeu_centavos > 0 ? `${decimal((parte / r.vendeu_centavos) * 100)}%` : "–";
  return (
    <article className="flex flex-col gap-6" data-testid="relatorio-do-mes">
      <header className="flex flex-col gap-1 border-b-2 border-tinta pb-3">
        <span className="text-sm font-semibold text-tinta-suave">
          {r.restaurante}, relatório do GIRO
        </span>
        <h2 className="font-placa text-4xl font-extrabold leading-none first-letter:uppercase">
          {nomeDoMes(r.mes)}
        </h2>
        <span className="text-sm text-tinta-suave">
          {r.completo
            ? `Noites de ${diaMes(r.primeira_noite)} a ${diaMes(r.ultima_noite)}.`
            : `Mês em andamento: noites de ${diaMes(r.primeira_noite)} até hoje, ${diaMes(r.ultima_noite)}.`}
          {!r.comparado_de &&
            " Sem comparação: o GIRO ainda não acompanhava o mês anterior inteiro."}
        </span>
      </header>

      <dl className="numeros grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-linha bg-linha md:grid-cols-5 print:grid-cols-5">
        <Numero
          rotulo="Vendeu"
          valor={reais(r.vendeu_centavos)}
          nota={vendeu ?? "nos pedidos lançados"}
        />
        <Numero
          rotulo="Mesas atendidas"
          valor={r.mesas_atendidas.toLocaleString("pt-BR")}
          nota={mesas ?? `${r.pessoas.toLocaleString("pt-BR")} pessoas`}
        />
        <Numero
          rotulo="Gasto por pessoa"
          valor={reais(r.ticket_medio_centavos)}
          nota={r.ticket_real ? "pelos pedidos lançados" : "o de Ajustes (poucos pedidos)"}
        />
        <Numero
          rotulo="Ficou na mesa"
          valor={reais(r.ficou_na_mesa_centavos)}
          nota={ficou ?? "mesa parada e quem foi embora"}
          alerta
        />
        <Numero
          rotulo="Nota dos clientes"
          valor={r.notas.media === null ? "–" : decimal(r.notas.media)}
          nota={`${r.notas.quantidade.toLocaleString("pt-BR")} notas pelo QR`}
        />
      </dl>

      <p className="max-w-prose">
        Foram {r.desistencias.toLocaleString("pt-BR")}{" "}
        {r.desistencias === 1 ? "mesa embora" : "mesas embora"} sem ninguém atender. A espera até o
        garçom ficou em {minutos(r.espera_media_seg)} e a mesa ficou parada suja{" "}
        {minutos(r.parada_media_seg)} em média. Giro de {decimal(r.giro_medio)} turmas por mesa, por
        noite.
      </p>

      <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
        <Secao titulo="Semana a semana">
          <Tabela
            colunas={["Semana", "Mesas", "Vendeu"]}
            linhas={r.semanas.map((s) => [
              `${diaMes(s.de)} a ${diaMes(s.ate)}`,
              s.mesas_atendidas.toLocaleString("pt-BR"),
              reais(s.vendeu_centavos),
            ])}
          />
        </Secao>
        <Secao titulo="Mais vendidos">
          {r.pratos.length === 0 ? (
            <p className="text-tinta-suave">Nenhum pedido lançado no GIRO neste mês.</p>
          ) : (
            <Tabela
              colunas={["Item", "Quantos", "Vendeu"]}
              linhas={r.pratos.map((p) => [
                p.nome,
                p.quantidade.toLocaleString("pt-BR"),
                reais(p.receita_centavos),
              ])}
            />
          )}
        </Secao>
      </div>

      {r.custo && (
        <Secao titulo="Custo (só o dono vê)">
          <dl className="numeros grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-linha bg-linha md:grid-cols-4 print:grid-cols-4">
            <Numero
              rotulo="Custo pela ficha"
              valor={pct(r.custo.custo_pela_ficha_centavos)}
              nota={`${reais(r.custo.custo_pela_ficha_centavos)} em ingredientes`}
            />
            <Numero
              rotulo="Custo de verdade"
              valor={pct(r.custo.custo_pela_ficha_centavos + r.custo.escapou_centavos)}
              nota="pelo estoque contado"
            />
            <Numero
              rotulo="Escapou do estoque"
              valor={reais(r.custo.escapou_centavos)}
              nota="perdas e o que sumiu"
              alerta
            />
            <Numero
              rotulo="Compras do mês"
              valor={reais(r.custo.compras_centavos)}
              nota="soma das notas lançadas"
            />
          </dl>
          {r.custo.por_motivo.length > 0 && (
            <p className="text-sm text-tinta-suave">
              Perdas registradas:{" "}
              {r.custo.por_motivo
                .map(
                  (m) =>
                    `${m.motivo.toLowerCase()} ${m.valor_centavos === null ? "" : reais(m.valor_centavos)}`,
                )
                .join(", ")}
              .
            </p>
          )}
        </Secao>
      )}

      <Secao titulo="Noite a noite">
        <Tabela
          compacta
          colunas={["Noite", "Mesas", "Embora", "Vendeu", "Ficou na mesa", "Espera", "Nota"]}
          linhas={r.noites.map((n) => [
            `${diaMes(n.dia)} ${diaDaSemana(n.dia).slice(0, 3)}`,
            String(n.mesas_atendidas),
            String(n.desistencias),
            reais(n.vendeu_centavos),
            reais(n.ficou_na_mesa_centavos),
            minutos(n.espera_media_seg),
            n.nota_media === null ? "–" : decimal(n.nota_media),
          ])}
        />
      </Secao>

      <footer className="border-t border-linha pt-3 text-xs text-tinta-suave">
        Mesas pela câmera do salão (o GIRO conta pessoas, não filma ninguém) e vendas pelos pedidos
        lançados no GIRO. O caixa do restaurante continua sendo o valor oficial para o contador.
      </footer>
    </article>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  alerta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-superficie px-4 py-3">
      <dt className="text-sm font-semibold text-tinta-suave">{rotulo}</dt>
      <dd className={`font-placa text-3xl font-extrabold ${alerta ? "text-atrasada" : ""}`}>
        {valor}
      </dd>
      <dd className="text-xs text-tinta-suave">{nota}</dd>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex break-inside-avoid flex-col gap-2">
      <h3 className="font-placa text-2xl font-bold">{titulo}</h3>
      {children}
    </section>
  );
}

function Tabela({
  colunas,
  linhas,
  compacta = false,
}: {
  colunas: string[];
  linhas: string[][];
  compacta?: boolean;
}) {
  const celula = compacta ? "px-3 py-1" : "px-3 py-2";
  return (
    <div className="relative overflow-x-auto rounded-xl border border-linha bg-superficie">
      <table className={`numeros w-full text-left ${compacta ? "text-sm" : ""}`}>
        <thead className="border-b border-linha text-tinta-suave">
          <tr>
            {colunas.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={`${celula} font-semibold ${i > 0 ? "text-right" : ""}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-linha">
          {linhas.map((linha) => (
            <tr key={linha[0]}>
              {linha.map((valor, i) =>
                i === 0 ? (
                  <th key={colunas[i]} scope="row" className={`${celula} font-semibold`}>
                    {valor}
                  </th>
                ) : (
                  <td key={colunas[i]} className={`${celula} whitespace-nowrap text-right`}>
                    {valor}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
