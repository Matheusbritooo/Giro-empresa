"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

import { Aviso, Esqueleto } from "@/components/ui";
import { api } from "@/lib/api";
import { useRelogio, useSalaoAoVivo } from "@/lib/ao-vivo";
import { useDados } from "@/lib/dados";
import {
  comRestaurante,
  irPara,
  juntarPendencias,
  pendenciasAoVivo,
  resumoDoSalao,
  textoDoCostume,
} from "@/lib/hoje";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { reais, rotuloDia } from "@/lib/resultados";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import type { Hoje, Pendencia } from "@/lib/tipos";

const ATUALIZAR_MS = 60_000;

function semAlerta() {}

/** O resumo do dia: como está a noite e o que pede atenção, com um toque para resolver. */
export default function PaginaHoje() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const restauranteNaUrl = useSearchParams().get("restaurante");
  const gestao = !!sessao && podeGerirMesas(sessao.usuario.papel);
  const buscar = useCallback(() => api<Hoje>("/api/hoje", { restaurante }), [restaurante]);
  const {
    dados: hoje,
    erro,
    recarregar,
  } = useDados(restaurante && gestao ? buscar : null, `hoje:${restaurante}`);
  // Pedido lançado, estoque mexido, algo que acabou: a conta de hoje muda junto.
  const { estado } = useSalaoAoVivo(restaurante, semAlerta, recarregar);
  const agora = useRelogio(estado.ajusteRelogioMs);

  // Cozinha atrasada aparece com o passar do tempo, sem ninguém lançar nada.
  useEffect(() => {
    const id = setInterval(recarregar, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [recarregar]);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  if (sessao && !gestao) return <Aviso>O resumo do dia fica com o dono e o gerente.</Aviso>;

  const salao = estado.salao;
  const resumo = salao ? resumoDoSalao(salao, agora) : null;
  const pendencias = juntarPendencias(
    salao ? pendenciasAoVivo(salao, agora) : [],
    hoje?.pendencias ?? [],
  );
  const link = (href: string) => comRestaurante(href, restauranteNaUrl);

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-placa text-4xl font-extrabold leading-none">Hoje</h1>
        {hoje && <p className="text-tinta-suave first-letter:uppercase">{rotuloDia(hoje.dia)}</p>}
      </header>
      <Aviso>{erro}</Aviso>

      <section aria-labelledby="titulo-agora" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="titulo-agora" className="font-placa text-2xl font-bold">
            Agora no salão
          </h2>
          <Link href={link("/salao")} className="font-semibold underline underline-offset-2">
            Abrir o salão
          </Link>
        </div>
        {resumo ? (
          <dl className="numeros grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-linha bg-linha">
            <Numero rotulo="Ocupadas" valor={`${resumo.ocupadas} de ${resumo.mesas}`} />
            <Numero
              rotulo="Esperando atendimento"
              valor={String(resumo.esperando)}
              nota={
                resumo.semAtendimento
                  ? `${resumo.semAtendimento} além do tempo`
                  : "todas dentro do tempo"
              }
              alerta={resumo.semAtendimento > 0}
            />
            <Numero rotulo="Para limpar" valor={String(resumo.paraLimpar)} />
          </dl>
        ) : (
          <Esqueleto formato="cartoes" linhas={2} rotulo="Abrindo o salão" />
        )}
      </section>

      <section aria-labelledby="titulo-noite" className="flex flex-col gap-2">
        <h2 id="titulo-noite" className="font-placa text-2xl font-bold">
          A noite até agora
        </h2>
        {hoje ? (
          <dl className="numeros grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-linha bg-linha md:grid-cols-4">
            <Numero
              rotulo="Mesas atendidas"
              valor={String(hoje.noite.mesas_atendidas)}
              nota={textoDoCostume(hoje.costuma)}
            />
            <Numero
              rotulo="Vendeu"
              valor={reais(hoje.noite.vendeu_centavos)}
              nota="nos pedidos lançados"
            />
            <Numero
              rotulo="Foram embora"
              valor={String(hoje.noite.desistencias)}
              nota="sem ninguém atender"
              alerta={hoje.noite.desistencias > 0}
            />
            <Numero
              rotulo="Ficou na mesa"
              valor={reais(hoje.noite.ficou_na_mesa_centavos)}
              nota="mesa parada e quem foi embora"
            />
          </dl>
        ) : (
          !erro && <Esqueleto formato="cartoes" rotulo="Fazendo a conta da noite" />
        )}
      </section>

      <section aria-labelledby="titulo-atencao" className="flex flex-col gap-2">
        <h2 id="titulo-atencao" className="font-placa text-2xl font-bold">
          O que pede atenção
        </h2>
        {!hoje && !erro ? (
          <Esqueleto linhas={3} rotulo="Conferindo cozinha e estoque" />
        ) : pendencias.length === 0 ? (
          <p className="rounded-xl border border-linha px-4 py-3 text-tinta-suave" role="status">
            Nada pedindo atenção agora.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="pendencias">
            {pendencias.map((pendencia) => (
              <LinhaPendencia
                key={`${pendencia.tipo}-${pendencia.texto}`}
                pendencia={pendencia}
                href={link(pendencia.href)}
              />
            ))}
          </ul>
        )}
      </section>

      {hoje && (
        <section aria-labelledby="titulo-esperar" className="flex max-w-prose flex-col gap-2">
          <h2 id="titulo-esperar" className="font-placa text-2xl font-bold">
            O que esperar de hoje
          </h2>
          {hoje.esperar.map((frase) => (
            <p key={frase}>{frase}</p>
          ))}
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            {hoje.dicas.map((dica) => (
              <li key={dica}>{dica}</li>
            ))}
          </ul>
        </section>
      )}
    </>
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
  nota?: string;
  alerta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-superficie px-4 py-3">
      <dt className="text-sm font-semibold text-tinta-suave">{rotulo}</dt>
      <dd className={`font-placa text-3xl font-extrabold ${alerta ? "text-atrasada" : ""}`}>
        {valor}
      </dd>
      {nota && <dd className="text-xs text-tinta-suave">{nota}</dd>}
    </div>
  );
}

function LinhaPendencia({ pendencia, href }: { pendencia: Pendencia; href: string }) {
  return (
    <li
      data-tipo={pendencia.tipo}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-l-[6px] bg-superficie py-3 pr-3 pl-4 ${
        pendencia.urgente ? "border-atrasada" : "border-linha"
      }`}
    >
      <span className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        {pendencia.urgente && (
          <span className="text-xs font-bold tracking-wide text-atrasada">Urgente</span>
        )}
        <span>{pendencia.texto}</span>
      </span>
      <Link
        href={href}
        className="min-h-9 shrink-0 font-semibold underline underline-offset-2"
        aria-label={`${irPara(pendencia.tipo)}: ${pendencia.texto}`}
      >
        {irPara(pendencia.tipo)}
      </Link>
    </li>
  );
}
