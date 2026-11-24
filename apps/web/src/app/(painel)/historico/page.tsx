"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Aviso, Esqueleto } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { GRUPOS, lerGrupo, lerPeriodoHistorico, PERIODOS, porDia } from "@/lib/historico";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { comBusca } from "@/lib/resultados";
import { podeGerirEquipe, useSessao } from "@/lib/sessao";
import type { Historico } from "@/lib/tipos";

/** Quem fez o quê: preço, custo, "acabou", estoque, cancelamento, equipe, ajustes e mesas. */
export default function PaginaHistorico() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
  const caminho = usePathname();
  const router = useRouter();
  const dono = !!sessao && podeGerirEquipe(sessao.usuario.papel);
  const periodo = lerPeriodoHistorico(parametros.get("periodo"));
  const grupo = lerGrupo(parametros.get("assunto"));
  const pessoa = Number(parametros.get("pessoa")) || null;

  const consulta = new URLSearchParams({ periodo });
  if (grupo) consulta.set("grupo", grupo);
  if (pessoa) consulta.set("pessoa", String(pessoa));
  const endereco = `/api/atividades?${consulta}`;
  const buscar = useCallback(
    () => api<Historico>(endereco, { restaurante }),
    [endereco, restaurante],
  );
  const { dados, erro } = useDados(
    restaurante && dono ? buscar : null,
    `historico:${restaurante}:${endereco}`,
  );

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  if (sessao && !dono) return <Aviso>O histórico de quem fez o quê fica com o dono.</Aviso>;

  const ir = (mudanca: Record<string, string | null>) =>
    router.replace(comBusca(caminho, parametros, mudanca), { scroll: false });
  const dias = dados ? porDia(dados.atividades, dados.hoje) : [];

  return (
    <>
      <div className="flex flex-col gap-3">
        <Link
          href={comBusca("/ajustes", parametros, { periodo: null, assunto: null, pessoa: null })}
          className="self-start font-semibold text-tinta-suave hover:text-tinta"
        >
          <span aria-hidden>‹ </span>Ajustes
        </Link>
        <header className="flex flex-col gap-1">
          <h1 className="font-placa text-4xl font-extrabold leading-none">Quem fez o quê</h1>
          <p className="max-w-prose text-tinta-suave">
            Mudança de preço e de custo, o que acabou, compras, perdas, contagens, pedidos
            cancelados, equipe, ajustes e mesas, com quem fez e quando. Nada se apaga.
          </p>
        </header>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div
          role="group"
          aria-label="Período"
          className="inline-flex rounded-lg border border-linha bg-superficie p-0.5"
        >
          {PERIODOS.map((p) => (
            <button
              key={p.valor}
              type="button"
              aria-pressed={periodo === p.valor}
              onClick={() => ir({ periodo: p.valor === "semana" ? null : p.valor })}
              className={`min-h-10 rounded-md px-3 text-sm font-semibold ${
                periodo === p.valor ? "bg-tinta text-fundo" : "text-tinta-suave hover:text-tinta"
              }`}
            >
              {p.texto}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Assunto
          <select
            value={grupo ?? ""}
            onChange={(e) => ir({ assunto: e.target.value || null })}
            className="min-h-11 rounded-lg border border-linha bg-superficie px-3 text-base font-normal"
          >
            <option value="">Tudo</option>
            {GRUPOS.map((g) => (
              <option key={g.valor} value={g.valor}>
                {g.texto}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Quem
          <select
            value={pessoa ?? ""}
            onChange={(e) => ir({ pessoa: e.target.value || null })}
            className="min-h-11 rounded-lg border border-linha bg-superficie px-3 text-base font-normal"
          >
            <option value="">Todo mundo</option>
            {(dados?.pessoas ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Aviso>{erro}</Aviso>

      {!dados ? (
        !erro && <Esqueleto linhas={6} rotulo="Abrindo o histórico" />
      ) : dias.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-linha p-6 text-tinta-suave">
          Nada nesse período. Quando alguém mudar um preço, lançar uma compra ou cancelar um pedido,
          aparece aqui.
        </p>
      ) : (
        <div className="flex flex-col gap-6" data-testid="historico">
          {dias.map((d) => (
            <section key={d.dia} aria-labelledby={`dia-${d.dia}`} className="flex flex-col gap-2">
              <h2
                id={`dia-${d.dia}`}
                className="font-placa text-2xl font-bold first-letter:uppercase"
              >
                {d.rotulo}
              </h2>
              <ol className="flex flex-col divide-y divide-linha rounded-xl border border-linha bg-superficie">
                {d.linhas.map((l) => (
                  <li
                    key={l.id}
                    className="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-0.5 px-4 py-3 sm:grid-cols-[3.5rem_1fr_auto]"
                  >
                    <span className="numeros text-tinta-suave">{l.hora}</span>
                    <span>{l.texto}</span>
                    <span className="col-start-2 text-sm font-semibold text-tinta-suave sm:col-start-3 sm:text-right">
                      {l.quem}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {dados.mais && (
            <p className="text-sm text-tinta-suave">
              Mostrando as 300 mais recentes. Escolha um assunto ou uma pessoa para ver o resto.
            </p>
          )}
        </div>
      )}
    </>
  );
}
