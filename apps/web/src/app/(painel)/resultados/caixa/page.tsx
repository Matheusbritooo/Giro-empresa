"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { Aviso, Esqueleto } from "@/components/ui";
import { api } from "@/lib/api";
import { parteVista, resumoDaConferencia, textoDaDiferenca, textoDoArquivo } from "@/lib/caixa";
import { useDados } from "@/lib/dados";
import { mesEscolhido, nomeDoMes, ultimosMeses } from "@/lib/relatorio";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { comBusca, noitePadrao, reais, rotuloDia } from "@/lib/resultados";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import type { Cardapio, ConferenciaCaixa, PreviaCaixa } from "@/lib/tipos";

const SEM_ITEM = "";

/** O caixa contra os pedidos do GIRO: importa a planilha de vendas e mostra o que passou sem
 * pedido. O arquivo é lido no aparelho e não fica guardado: só as somas por noite e produto. */
export default function PaginaCaixa() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const parametros = useSearchParams();
  const caminho = usePathname();
  const router = useRouter();
  const gestao = !!sessao && podeGerirMesas(sessao.usuario.papel);
  const [hoje] = useState(() => noitePadrao(Date.now(), sessao?.restaurante?.abre_as ?? "18:00"));
  const mes = mesEscolhido(parametros.get("mes"), hoje);

  const buscar = useCallback(
    () => api<ConferenciaCaixa>(`/api/caixa/conferencia?mes=${mes}`, { restaurante }),
    [mes, restaurante],
  );
  const {
    dados: conferencia,
    erro,
    recarregar,
  } = useDados(restaurante && gestao ? buscar : null, `caixa:${restaurante}:${mes}`);
  const buscarCardapio = useCallback(
    () => api<Cardapio>("/api/cardapio", { restaurante }),
    [restaurante],
  );
  const { dados: cardapio } = useDados(
    restaurante && gestao ? buscarCardapio : null,
    `cardapio:${restaurante}`,
  );

  const [arquivo, setArquivo] = useState<{ nome: string; texto: string } | null>(null);
  const [previa, setPrevia] = useState<PreviaCaixa | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  if (sessao && !gestao)
    return <Aviso>A conferência com o caixa fica com o dono e o gerente.</Aviso>;

  const ir = (mudanca: Record<string, string | null>) =>
    router.replace(comBusca(caminho, parametros, mudanca), { scroll: false });

  async function escolherArquivo(campo: HTMLInputElement) {
    const escolhido = campo.files?.[0];
    setRecado(null);
    setPrevia(null);
    if (!escolhido) return;
    const texto = textoDoArquivo(await escolhido.arrayBuffer());
    campo.value = ""; // a mesma planilha pode ser escolhida de novo depois
    setArquivo({ nome: escolhido.name, texto });
    setEnviando(true);
    try {
      const lida = await api<PreviaCaixa>("/api/caixa/previa", {
        metodo: "POST",
        corpo: { arquivo: texto },
        restaurante,
      });
      setPrevia(lida);
      setEscolhas(
        Object.fromEntries(
          lida.nomes.map((n) => [
            n.nome,
            n.sugestao_item_id ? String(n.sugestao_item_id) : SEM_ITEM,
          ]),
        ),
      );
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  async function importar() {
    if (!arquivo || !previa) return;
    setEnviando(true);
    try {
      const feita = await api<PreviaCaixa>("/api/caixa/importar", {
        metodo: "POST",
        corpo: {
          arquivo: arquivo.texto,
          associacoes: Object.entries(escolhas).map(([nome, item]) => ({
            nome,
            item_id: item ? Number(item) : null,
          })),
        },
        restaurante,
      });
      setRecado({
        tipo: "ok",
        texto: `Planilha importada: ${feita.noites} ${feita.noites === 1 ? "noite" : "noites"}, ${reais(feita.total_centavos)}.`,
      });
      setPrevia(null);
      setArquivo(null);
      const mesImportado = feita.ate.slice(0, 7);
      if (mesImportado !== mes) ir({ mes: mesImportado });
      else recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  const itensDoCardapio = (cardapio?.itens ?? []).filter((i) => i.ativo);

  return (
    <>
      <div className="flex flex-col gap-3">
        <Link
          href={comBusca("/resultados", parametros, { mes: null })}
          className="self-start font-semibold text-tinta-suave hover:text-tinta"
        >
          <span aria-hidden>‹ </span>Resultados
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-placa text-4xl font-extrabold leading-none">
              Conferir com o caixa
            </h1>
            <p className="max-w-prose text-tinta-suave">
              Importe a planilha de vendas do seu sistema de caixa e veja o que foi vendido sem
              pedido no GIRO. O caixa continua sendo o valor oficial.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Mês
            <select
              value={mes}
              onChange={(e) => ir({ mes: e.target.value })}
              className="min-h-11 rounded-lg border border-linha bg-superficie px-3 text-base font-normal"
            >
              {ultimosMeses(hoje, 12).map((m) => (
                <option key={m} value={m}>
                  {nomeDoMes(m)}
                </option>
              ))}
            </select>
          </label>
        </header>
      </div>
      <Aviso>{erro}</Aviso>
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}

      <section
        aria-labelledby="titulo-importar"
        className="flex flex-col gap-3 rounded-xl border border-linha bg-superficie p-4"
      >
        <h2 id="titulo-importar" className="font-placa text-2xl font-bold">
          Importar a planilha
        </h2>
        <p className="text-sm text-tinta-suave">
          No sistema de caixa, exporte as vendas por item em planilha (CSV), com data, produto,
          quantidade e valor. O GIRO lê só essas colunas: nome de cliente, CPF ou forma de pagamento
          são ignorados. Importar de novo as mesmas noites troca as anteriores.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-tinta px-4 font-semibold text-fundo has-focus-visible:outline-2 has-focus-visible:outline-offset-2 ${enviando ? "pointer-events-none opacity-50" : ""}`}
          >
            Escolher a planilha
            <input
              type="file"
              aria-label="Planilha do caixa"
              accept=".csv,.txt,text/csv,text/plain"
              disabled={enviando}
              onChange={(e) => void escolherArquivo(e.currentTarget)}
              className="sr-only"
            />
          </label>
          <span className="text-tinta-suave">{arquivo ? arquivo.nome : "Nenhuma escolhida"}</span>
        </div>
        {enviando && !previa && <Esqueleto linhas={3} rotulo="Lendo a planilha" />}

        {previa && (
          <div className="flex flex-col gap-3" data-testid="previa-caixa">
            <p>
              {previa.de === previa.ate
                ? `Noite de ${rotuloDia(previa.de)}`
                : `De ${rotuloDia(previa.de)} a ${rotuloDia(previa.ate)}`}
              : {previa.noites} {previa.noites === 1 ? "noite" : "noites"}, {previa.linhas}{" "}
              {previa.linhas === 1 ? "linha" : "linhas"}, {reais(previa.total_centavos)}.
              {previa.ignoradas > 0 &&
                ` ${previa.ignoradas} ${previa.ignoradas === 1 ? "linha ficou" : "linhas ficaram"} de fora (sem data, produto ou valor).`}
            </p>
            {previa.avisos.map((aviso) => (
              <p key={aviso} className="text-sm text-tinta-suave">
                {aviso}
              </p>
            ))}
            {previa.noites_ja_importadas > 0 && (
              <Aviso>
                {previa.noites_ja_importadas}{" "}
                {previa.noites_ja_importadas === 1
                  ? "noite já tinha sido importada e vai ser trocada"
                  : "noites já tinham sido importadas e vão ser trocadas"}
                .
              </Aviso>
            )}
            <h3 className="font-semibold">Qual item do cardápio é cada produto do caixa?</h3>
            <div className="relative overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-sm text-tinta-suave">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      No caixa
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      Vendeu
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      No cardápio do GIRO
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {previa.nomes.map((n) => (
                    <tr key={n.nome}>
                      <th scope="row" className="py-2 pr-3 font-normal">
                        {n.nome}
                      </th>
                      <td className="numeros py-2 pr-3 text-right whitespace-nowrap">
                        {n.quantidade} · {reais(n.valor_centavos)}
                      </td>
                      <td className="py-2">
                        <select
                          aria-label={`Item do cardápio para ${n.nome}`}
                          value={escolhas[n.nome] ?? SEM_ITEM}
                          onChange={(e) =>
                            setEscolhas((atual) => ({ ...atual, [n.nome]: e.target.value }))
                          }
                          className="min-h-11 w-full min-w-48 rounded-lg border border-linha bg-superficie px-2"
                        >
                          <option value={SEM_ITEM}>Não é do cardápio</option>
                          {itensDoCardapio.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.nome}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => void importar()}
              disabled={enviando}
              className="inline-flex min-h-11 items-center self-start rounded-lg bg-tinta px-4 font-semibold text-fundo disabled:opacity-50"
            >
              Importar planilha
            </button>
          </div>
        )}
      </section>

      <section aria-labelledby="titulo-conferencia" className="flex flex-col gap-3">
        <h2
          id="titulo-conferencia"
          className="font-placa text-2xl font-bold first-letter:uppercase"
        >
          {nomeDoMes(mes)}
        </h2>
        {!conferencia ? (
          !erro && <Esqueleto formato="cartoes" linhas={3} rotulo="Conferindo" />
        ) : conferencia.noites.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-linha p-6 text-tinta-suave">
            Nenhuma noite do caixa importada neste mês.
          </p>
        ) : (
          <div className="flex flex-col gap-4" data-testid="conferencia-caixa">
            <dl className="numeros grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-linha bg-linha sm:grid-cols-3">
              <Numero rotulo="No caixa" valor={reais(conferencia.caixa_centavos)} />
              <Numero
                rotulo="Com pedido no GIRO"
                valor={reais(conferencia.giro_centavos)}
                nota={parteVista(conferencia) ? `${parteVista(conferencia)} do caixa` : undefined}
              />
              <Numero
                rotulo="Diferença"
                valor={textoDaDiferenca(conferencia.caixa_centavos, conferencia.giro_centavos)}
              />
            </dl>
            <p className="max-w-prose">{resumoDaConferencia(conferencia)}</p>

            <h3 className="font-placa text-xl font-bold">Noite a noite</h3>
            <div className="relative overflow-x-auto rounded-xl border border-linha bg-superficie">
              <table className="w-full text-left">
                <thead className="text-sm text-tinta-suave">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Noite
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Caixa
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      GIRO
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Diferença
                    </th>
                  </tr>
                </thead>
                <tbody className="numeros divide-y divide-linha">
                  {conferencia.noites.map((n) => (
                    <tr key={n.noite}>
                      <th scope="row" className="px-3 py-2 font-normal first-letter:uppercase">
                        {rotuloDia(n.noite)}
                      </th>
                      <td className="px-3 py-2 text-right">{reais(n.caixa_centavos)}</td>
                      <td className="px-3 py-2 text-right">{reais(n.giro_centavos)}</td>
                      <td className="px-3 py-2">
                        {textoDaDiferenca(n.caixa_centavos, n.giro_centavos)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="font-placa text-xl font-bold">Onde está a diferença</h3>
            <div className="relative overflow-x-auto rounded-xl border border-linha bg-superficie">
              <table className="w-full text-left">
                <thead className="text-sm text-tinta-suave">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Item
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Caixa
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      GIRO
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Diferença
                    </th>
                  </tr>
                </thead>
                <tbody className="numeros divide-y divide-linha">
                  {conferencia.itens.map((i) => (
                    <tr key={`${i.item_id ?? "caixa"}-${i.nome}`}>
                      <th scope="row" className="px-3 py-2 font-normal">
                        {i.nome}
                      </th>
                      <td className="px-3 py-2 text-right">{i.caixa_quantidade}</td>
                      <td className="px-3 py-2 text-right">{i.giro_quantidade}</td>
                      <td className="px-3 py-2">
                        {textoDaDiferenca(i.caixa_centavos, i.giro_centavos)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {conferencia.sem_associacao.length > 0 && (
              <p className="text-sm text-tinta-suave">
                Sem item do cardápio (contam só no total da noite):{" "}
                {conferencia.sem_associacao.join(", ")}.
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-superficie px-4 py-3">
      <dt className="text-sm font-semibold text-tinta-suave">{rotulo}</dt>
      <dd className="font-placa text-2xl font-extrabold">{valor}</dd>
      {nota && <dd className="text-xs text-tinta-suave">{nota}</dd>}
    </div>
  );
}
