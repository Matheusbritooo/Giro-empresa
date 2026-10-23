"use client";

import Link from "next/link";

import {
  type Comparacao,
  comparar,
  decimal,
  diaDaSemana,
  minutos,
  nomeDoAnterior,
  reais,
  rotuloDia,
} from "@/lib/resultados";
import type { Indicadores, Periodo, Resultados, ResumoNoite } from "@/lib/tipos";

import { type Barra, GraficoBarras } from "./grafico-barras";

function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/** "Na sexta, 16/10" / "Nos últimos 7 dias" / "Nas últimas 4 semanas" */
export function quando(periodo: Periodo, dia: string): string {
  if (periodo === "semana") return "Nos últimos 7 dias";
  if (periodo === "mes") return "Nas últimas 4 semanas";
  const nome = diaDaSemana(dia);
  return `${nome === "sábado" || nome === "domingo" ? "No" : "Na"} ${rotuloDia(dia)}`;
}

/**
 * O dinheiro que ficou na mesa: quem foi embora sem ser atendido e a mesa parada suja com o
 * salão cheio. Em forma de comanda, porque é a conta que o dono não viu.
 */
export function FicouNaMesa({
  resultados,
  podeAjustar,
  replay,
  linkAjustes,
  aoVerAntes,
}: {
  resultados: Resultados;
  podeAjustar: boolean;
  replay: { href: string; texto: string } | null;
  linkAjustes: string;
  /** Sem movimento no período: leva para o período anterior. */
  aoVerAntes: () => void;
}) {
  const { atual, anterior, periodo, dia } = resultados;
  const comparacao = comparar(
    atual.perdido_total_centavos,
    anterior.mesas_atendidas + anterior.desistencias > 0 ? anterior.perdido_total_centavos : null,
    true,
    nomeDoAnterior(periodo, dia),
  );
  const semMovimento = atual.mesas_atendidas + atual.desistencias === 0;
  const excessoParada = atual.parada_media_seg;

  return (
    <section
      aria-labelledby="titulo-ficou"
      className="grid gap-6 rounded-2xl border border-linha bg-superficie p-5 md:grid-cols-[1fr_minmax(18rem,26rem)] md:p-7"
    >
      <div className="flex flex-col justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 id="titulo-ficou" className="font-placa text-2xl font-bold">
            Dinheiro que ficou na mesa
          </h2>
          {semMovimento ? (
            <div className="flex flex-col items-start gap-3">
              <p className="max-w-prose text-lg">
                {quando(periodo, dia)}, nenhuma mesa foi registrada
                {periodo === "noite" ? " até agora" : ""}.
              </p>
              <button
                type="button"
                onClick={aoVerAntes}
                className="inline-flex min-h-11 items-center rounded-lg bg-tinta px-4 font-semibold text-fundo hover:opacity-90"
              >
                {periodo === "noite" ? "Ver a noite anterior" : "Ver o período anterior"}
              </button>
            </div>
          ) : (
            <>
              <p
                className="numeros font-placa text-6xl font-extrabold leading-none sm:text-7xl"
                data-testid="perdido-total"
              >
                {reais(atual.perdido_total_centavos)}
              </p>
              <p className="max-w-prose text-lg">
                {atual.perdido_total_centavos > 0
                  ? `${quando(periodo, dia)}, é o que deixou de entrar por cliente que foi embora sem atendimento e por mesa suja com o salão cheio.`
                  : `${quando(periodo, dia)}, ninguém foi embora sem atendimento e as mesas foram liberadas rápido.`}
              </p>
            </>
          )}
          {comparacao && !semMovimento && <LinhaComparacao comparacao={comparacao} />}
        </div>
        {replay && !semMovimento && (
          <Link
            href={replay.href}
            className="inline-flex min-h-11 items-center self-start rounded-lg bg-tinta px-4 font-semibold text-fundo hover:opacity-90"
          >
            {replay.texto}
          </Link>
        )}
      </div>

      {!semMovimento && (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-linha bg-fundo p-4">
          <p className="text-sm font-semibold text-tinta-suave">A conta</p>
          <LinhaConta
            texto="Foram embora sem atendimento"
            detalhe={`${plural(atual.desistencias, "mesa", "mesas")}, ${plural(atual.pessoas_desistiram, "pessoa", "pessoas")}`}
            valor={atual.perdido_desistencias_centavos}
          />
          <LinhaConta
            texto="Mesa suja com o salão cheio"
            detalhe={
              excessoParada === null
                ? "sem mesa liberada no período"
                : `cada mesa ficou ${minutos(excessoParada)} parada, em média`
            }
            valor={atual.perdido_mesa_parada_centavos}
          />
          <div className="flex items-baseline justify-between gap-3 border-t border-linha pt-3 font-bold">
            <span>Total</span>
            <span className="numeros whitespace-nowrap">{reais(atual.perdido_total_centavos)}</span>
          </div>
          <p className="text-xs text-tinta-suave">
            Estimativa com {reais(atual.ticket_medio_centavos)} por pessoa.{" "}
            {podeAjustar ? (
              <Link href={linkAjustes} className="underline underline-offset-2">
                Mudar o valor em Ajustes
              </Link>
            ) : (
              "O dono muda esse valor em Ajustes."
            )}
          </p>
        </div>
      )}
    </section>
  );
}

function LinhaConta({ texto, detalhe, valor }: { texto: string; detalhe: string; valor: number }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{texto}</span>
        <span aria-hidden className="min-w-4 flex-1 border-b-2 border-dotted border-linha" />
        <span className="numeros whitespace-nowrap font-semibold">{reais(valor)}</span>
      </div>
      <span className="text-sm text-tinta-suave">{detalhe}</span>
    </div>
  );
}

/** "Melhorou: 18% a menos que a sexta passada", com um sinal que não depende só da cor. */
function LinhaComparacao({ comparacao }: { comparacao: Comparacao }) {
  const palavra = { melhor: "Melhorou", pior: "Piorou", igual: "Igual" }[comparacao.tom];
  // A seta diz para onde o número foi; a palavra e a cor dizem se isso é bom.
  const sinal = comparacao.tom === "igual" ? "=" : comparacao.texto.includes("a menos") ? "▼" : "▲";
  const cor = {
    melhor: "text-ocupada",
    pior: "text-atrasada",
    igual: "text-tinta-suave",
  }[comparacao.tom];
  return (
    <p className="flex items-baseline gap-1.5 text-sm">
      <span aria-hidden className={`text-xs ${cor}`}>
        {sinal}
      </span>
      <span>
        <span className="font-semibold">{palavra}:</span>{" "}
        <span className="text-tinta-suave">{comparacao.texto}</span>
      </span>
    </p>
  );
}

/** Os números do salão, cada um comparado com o período anterior. */
export function Placar({ resultados }: { resultados: Resultados }) {
  const { atual, anterior, periodo, dia } = resultados;
  const nome = nomeDoAnterior(periodo, dia);
  const teveAntes = anterior.mesas_atendidas + anterior.desistencias > 0;
  const comp = (a: number | null, b: number | null, menorEMelhor: boolean) =>
    teveAntes ? comparar(a, b, menorEMelhor, nome) : null;
  const porNoite = periodo === "noite" ? "" : " por noite";

  const itens: { titulo: string; valor: string; detalhe: string; comparacao: Comparacao | null }[] =
    [
      {
        titulo: "Mesas atendidas",
        valor: atual.mesas_atendidas.toLocaleString("pt-BR"),
        detalhe: plural(atual.pessoas_atendidas, "pessoa", "pessoas"),
        comparacao: comp(atual.mesas_atendidas, anterior.mesas_atendidas, false),
      },
      {
        titulo: "Giro da mesa",
        valor: decimal(atual.giro_medio),
        detalhe: `vezes que cada mesa recebeu cliente${porNoite}`,
        comparacao: comp(atual.giro_medio, anterior.giro_medio, false),
      },
      {
        titulo: "Espera até o garçom",
        valor: minutos(atual.espera_media_seg),
        detalhe:
          atual.esperas_acima_do_limite > 0
            ? `${plural(atual.esperas_acima_do_limite, "mesa esperou", "mesas esperaram")} demais`
            : "nenhuma mesa esperou demais",
        comparacao: comp(atual.espera_media_seg, anterior.espera_media_seg, true),
      },
      {
        titulo: "Mesa parada suja",
        valor: minutos(atual.parada_media_seg),
        detalhe: "do cliente sair até liberar",
        comparacao: comp(atual.parada_media_seg, anterior.parada_media_seg, true),
      },
      {
        titulo: "Foram embora",
        valor: atual.desistencias.toLocaleString("pt-BR"),
        detalhe: "mesas sem atendimento",
        comparacao: comp(atual.desistencias, anterior.desistencias, true),
      },
    ];

  return (
    <section aria-label="Números do salão">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-linha bg-linha md:grid-cols-5">
        {itens.map((item) => (
          <div
            key={item.titulo}
            className="flex flex-col gap-1 bg-superficie p-4 last:col-span-2 md:last:col-span-1"
          >
            <dt className="text-sm font-semibold text-tinta-suave">{item.titulo}</dt>
            <dd className="numeros font-placa text-4xl font-extrabold leading-none">
              {item.valor}
            </dd>
            <dd className="text-sm text-tinta-suave">{item.detalhe}</dd>
            {item.comparacao && (
              <dd>
                <LinhaComparacao comparacao={item.comparacao} />
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

function rotuloHora(hora: number): string {
  return `${hora}h`;
}

/** Ocupação por hora (pico em destaque) e, na semana e no mês, o dinheiro perdido noite a noite. */
export function Graficos({ resultados }: { resultados: Resultados }) {
  const { atual, periodo, noites } = resultados;
  const porHora = atual.por_hora;
  const pico = porHora.reduce<number | null>(
    (melhor, p, i) => (melhor === null || p.ocupacao > porHora[melhor].ocupacao ? i : melhor),
    null,
  );
  const barrasHora: Barra[] = porHora.map((p, i) => ({
    chave: String(p.hora),
    rotulo: rotuloHora(p.hora),
    valor: p.ocupacao,
    texto: `${rotuloHora(p.hora)}: ${Math.round(p.ocupacao * 100)}% das mesas ocupadas`,
    detalhe: `${decimal(p.chegadas, p.chegadas % 1 === 0 ? 0 : 1)} ${p.chegadas === 1 ? "mesa chegou" : "mesas chegaram"}${periodo === "noite" ? "" : " por noite, em média"}`,
    destaque: i === pico,
  }));

  const comMovimento = noites.filter((n) => n.mesas_atendidas + n.desistencias > 0);
  const maisCara = comMovimento.reduce<ResumoNoite | null>(
    (pior, n) =>
      pior === null || n.perdido_total_centavos > pior.perdido_total_centavos ? n : pior,
    null,
  );
  const piorNoite = maisCara && maisCara.perdido_total_centavos > 0 ? maisCara : null;
  const barrasNoites: Barra[] = noites.map((n, i) => {
    const fechado = n.mesas_atendidas + n.desistencias === 0;
    const mostrar = noites.length <= 7 || i % 7 === noites.length % 7 || i === noites.length - 1;
    return {
      chave: n.dia,
      rotulo: mostrar ? (noites.length <= 7 ? diaDaSemana(n.dia).slice(0, 3) : n.dia.slice(8)) : "",
      valor: n.perdido_total_centavos,
      texto: `${rotuloDia(n.dia)}: ${fechado ? "sem movimento" : reais(n.perdido_total_centavos)}`,
      detalhe: fechado
        ? undefined
        : `${plural(n.mesas_atendidas, "mesa atendida", "mesas atendidas")}, ${plural(n.desistencias, "foi embora", "foram embora")}`,
      destaque: n === piorNoite,
    };
  });
  const maiorPerda = Math.max(0, ...noites.map((n) => n.perdido_total_centavos));

  if (porHora.length === 0 && noites.length === 0) return null;

  return (
    <section
      aria-label="Gráficos"
      className={`grid gap-6 rounded-2xl border border-linha bg-superficie p-5 md:p-6 ${noites.length > 0 ? "lg:grid-cols-2" : ""}`}
    >
      {porHora.length > 0 && (
        <GraficoBarras
          titulo="Salão cheio por hora"
          descricao={
            pico === null
              ? undefined
              : `O pico é às ${rotuloHora(porHora[pico].hora)}. Acima da linha, toda mesa parada custa dinheiro.`
          }
          barras={barrasHora}
          maximo={1}
          cor="ocupada"
          valorDestaque={pico === null ? undefined : `${Math.round(porHora[pico].ocupacao * 100)}%`}
          linhaGuia={{ valor: 0.75, texto: "cheio" }}
        />
      )}
      {noites.length > 0 && (
        <GraficoBarras
          titulo="Dinheiro que ficou na mesa, noite a noite"
          descricao={
            piorNoite
              ? `A pior foi ${rotuloDia(piorNoite.dia)}: ${reais(piorNoite.perdido_total_centavos)}.`
              : "Nenhuma noite com perda no período."
          }
          barras={barrasNoites}
          maximo={maiorPerda}
          cor="tinta"
          valorDestaque={piorNoite ? reais(piorNoite.perdido_total_centavos) : undefined}
        />
      )}
    </section>
  );
}

/** As mesas que mais custaram no período: onde o dono deve olhar primeiro. */
export function MesasQueMaisCustam({ atual }: { atual: Indicadores }) {
  const mesas = [...atual.por_mesa]
    .filter((m) => m.perdido_centavos > 0)
    .sort((a, b) => b.perdido_centavos - a.perdido_centavos)
    .slice(0, 5);
  if (mesas.length === 0) return null;
  return (
    <section aria-labelledby="titulo-mesas-custam" className="flex flex-col gap-3">
      <h2 id="titulo-mesas-custam" className="font-placa text-2xl font-bold">
        Mesas que mais custaram
      </h2>
      <div className="overflow-x-auto rounded-2xl border border-linha bg-superficie">
        <table className="w-full min-w-[34rem] text-left">
          <thead className="border-b border-linha text-sm text-tinta-suave">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Mesa
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Clientes atendidos
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Foram embora
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Parada suja, em média
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Ficou na mesa
              </th>
            </tr>
          </thead>
          <tbody className="numeros divide-y divide-linha">
            {mesas.map((m) => (
              <tr key={m.numero}>
                <th scope="row" className="px-4 py-3 font-placa text-2xl font-extrabold">
                  {m.numero}
                  <span className="ml-2 font-sans text-sm font-normal text-tinta-suave">
                    {m.lugares} lugares
                  </span>
                </th>
                <td className="px-4 py-3 text-right">{m.visitas}</td>
                <td className="px-4 py-3 text-right">{m.desistencias}</td>
                <td className="px-4 py-3 text-right">{minutos(m.parada_media_seg)}</td>
                <td className="px-4 py-3 text-right font-bold">{reais(m.perdido_centavos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
