"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { Copiloto } from "@/components/resultados/copiloto";
import { ESe } from "@/components/resultados/e-se";
import { FicouNaMesa, Graficos, MesasQueMaisCustam, Placar } from "@/components/resultados/numeros";
import { Aviso } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { useRestauranteAlvo } from "@/lib/restaurante";
import {
  comBusca,
  lerDia,
  lerPeriodo,
  noitePadrao,
  PASSO_DIAS,
  rotuloDia,
  somarDias,
} from "@/lib/resultados";
import { podeGerirEquipe, podeGerirMesas, useSessao } from "@/lib/sessao";
import type { Periodo, Resultados } from "@/lib/tipos";

const ABAS: [Periodo, string][] = [
  ["noite", "Noite"],
  ["semana", "7 dias"],
  ["mes", "4 semanas"],
];

export default function PaginaResultados() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
  const caminho = usePathname();
  const router = useRouter();
  const [hoje] = useState(() => noitePadrao(Date.now(), sessao?.restaurante?.abre_as ?? "18:00"));
  const periodo = lerPeriodo(parametros.get("periodo"));
  const pedido = lerDia(parametros.get("dia"));
  const dia = pedido && pedido <= hoje ? pedido : hoje;

  const buscar = useCallback(
    () => api<Resultados>(`/api/resultados?periodo=${periodo}&dia=${dia}`, { restaurante }),
    [periodo, dia, restaurante],
  );
  const { dados, erro } = useDados(restaurante ? buscar : null);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  if (sessao && !podeGerirMesas(sessao.usuario.papel)) {
    return <Aviso>Os resultados do salão ficam com o dono e o gerente.</Aviso>;
  }

  const ir = (mudar: Record<string, string | null>) =>
    router.replace(comBusca(caminho, parametros, mudar), { scroll: false });
  const passo = PASSO_DIAS[periodo];
  const proximo = somarDias(dia, passo);
  const atualizando = !dados || dados.dia !== dia || dados.periodo !== periodo;
  const noiteParaRever =
    periodo === "noite"
      ? dia
      : (dados?.noites.reduce<{ dia: string; valor: number } | null>(
          (pior, n) =>
            n.perdido_total_centavos > (pior?.valor ?? 0)
              ? { dia: n.dia, valor: n.perdido_total_centavos }
              : pior,
          null,
        )?.dia ?? null);
  const restauranteNaUrl = parametros.get("restaurante");
  const busca = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...(restauranteNaUrl ? { restaurante: restauranteNaUrl } : {}),
      ...extra,
    });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-placa text-4xl font-extrabold leading-none">Resultados</h1>
        <div
          role="group"
          aria-label="Período"
          className="inline-flex rounded-lg border border-linha bg-superficie p-0.5"
        >
          {ABAS.map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={periodo === valor}
              onClick={() => ir({ periodo: valor === "noite" ? null : valor })}
              className={`min-h-10 rounded-md px-3 text-sm font-semibold ${
                periodo === valor ? "bg-tinta text-fundo" : "text-tinta-suave hover:text-tinta"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      <nav aria-label="Escolher a data" className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => ir({ dia: somarDias(dia, -passo) })}
          className="min-h-11 rounded-lg border border-linha bg-superficie px-3 font-semibold"
        >
          <span aria-hidden>‹ </span>
          {periodo === "noite" ? "Noite anterior" : "Antes"}
        </button>
        <p className="min-w-40 px-1 text-center font-semibold" aria-live="polite">
          {periodo === "noite"
            ? rotuloDia(dia)
            : `${rotuloDia(somarDias(dia, 1 - passo))} até ${rotuloDia(dia)}`}
        </p>
        <button
          type="button"
          onClick={() => ir({ dia: proximo >= hoje ? null : proximo })}
          disabled={dia >= hoje}
          className="min-h-11 rounded-lg border border-linha bg-superficie px-3 font-semibold disabled:opacity-40"
        >
          {periodo === "noite" ? "Próxima noite" : "Depois"}
          <span aria-hidden> ›</span>
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm text-tinta-suave">
          Ir para o dia
          <input
            type="date"
            value={dia}
            max={hoje}
            onChange={(e) => {
              const escolhido = lerDia(e.target.value);
              if (escolhido) ir({ dia: escolhido >= hoje ? null : escolhido });
            }}
            className="min-h-11 rounded-lg border border-linha bg-superficie px-2 text-base text-tinta"
          />
        </label>
      </nav>

      <Aviso>{erro}</Aviso>

      {dados ? (
        <div
          className={`flex flex-col gap-6 transition-opacity ${atualizando ? "opacity-60" : ""}`}
          aria-busy={atualizando}
        >
          <FicouNaMesa
            resultados={dados}
            podeAjustar={!!sessao && podeGerirEquipe(sessao.usuario.papel)}
            linkAjustes={comBusca("/ajustes", busca({}), {})}
            aoVerAntes={() => ir({ dia: somarDias(dia, -passo) })}
            replay={
              noiteParaRever
                ? {
                    href: comBusca("/resultados/replay", busca({ dia: noiteParaRever }), {}),
                    texto:
                      periodo === "noite"
                        ? "Rever a noite no salão"
                        : `Rever a pior noite (${rotuloDia(noiteParaRever)})`,
                  }
                : null
            }
          />
          <Copiloto restaurante={restaurante} />
          {dados.atual.mesas_atendidas + dados.atual.desistencias > 0 && (
            <>
              <Placar resultados={dados} />
              <Graficos resultados={dados} />
              <MesasQueMaisCustam atual={dados.atual} />
            </>
          )}
          <ESe restaurante={restaurante} dia={dia} />
          <p className="text-sm text-tinta-suave">
            Os números saem só dos horários de cada mesa (quando sentaram, foram atendidos, saíram e
            a mesa foi liberada). Nenhuma imagem é guardada.{" "}
            <Link href={comBusca("/salao", busca({}), {})} className="underline underline-offset-2">
              Voltar ao salão ao vivo
            </Link>
          </p>
        </div>
      ) : (
        !erro && <p className="text-tinta-suave">Fazendo as contas da noite...</p>
      )}
    </>
  );
}
