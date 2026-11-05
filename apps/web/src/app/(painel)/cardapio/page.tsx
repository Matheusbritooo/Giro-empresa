"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Aviso, Botao, Campo, Secao, Selecao } from "@/components/ui";
import { api } from "@/lib/api";
import { useSalaoAoVivo } from "@/lib/ao-vivo";
import { useDados } from "@/lib/dados";
import { campoDosCentavos, centavosDoCampo, preco } from "@/lib/pedido";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import type { AvisoAoVivo, Cardapio, CategoriaCardapio, ItemCardapio } from "@/lib/tipos";

function semAlerta() {}

type Recado = { tipo: "erro" | "ok"; texto: string } | null;

export default function PaginaCardapio() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const gestao = !!sessao && podeGerirMesas(sessao.usuario.papel);
  const buscar = useCallback(() => api<Cardapio>("/api/cardapio", { restaurante }), [restaurante]);
  const { dados, erro, recarregar } = useDados(restaurante ? buscar : null);
  const aoAviso = useCallback(
    // Compra muda o preço dos ingredientes, e com ele o custo dos pratos com ficha.
    (aviso: AvisoAoVivo) => (aviso.tipo === "cardapio" || aviso.tipo === "estoque") && recarregar(),
    [recarregar],
  );
  useSalaoAoVivo(restaurante, semAlerta, aoAviso);
  const [recado, setRecado] = useState<Recado>(null);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;

  async function mudar(item: ItemCardapio, corpo: Record<string, unknown>, texto: string) {
    try {
      await api(`/api/cardapio/itens/${item.id}`, { metodo: "PATCH", corpo });
      setRecado({ tipo: "ok", texto });
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  async function temHoje(item: ItemCardapio, disponivel: boolean): Promise<boolean> {
    try {
      await api(`/api/cardapio/itens/${item.id}/disponivel`, {
        metodo: "POST",
        corpo: { disponivel },
      });
      setRecado({
        tipo: "ok",
        texto: disponivel
          ? `${item.nome} voltou para o cardápio de hoje.`
          : `${item.nome} marcado como acabou. Os garçons já veem riscado.`,
      });
      recarregar();
      return true;
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
      return false;
    }
  }

  return (
    <>
      <h1 className="font-placa text-4xl font-extrabold leading-none">Cardápio</h1>
      <p className="max-w-prose text-tinta-suave">
        {gestao
          ? `Preço novo vale só para os próximos pedidos: o que já foi lançado fica com o preço da hora.${dados?.mostra_custo ? " Custo e lucro de cada prato só você vê." : ""}`
          : "Marque o que acabou: os garçons veem riscado na hora."}
      </p>
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      <Aviso>{erro}</Aviso>

      {!dados ? (
        !erro && <p className="text-tinta-suave">Abrindo o cardápio...</p>
      ) : (
        <>
          {dados.categorias.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-linha p-6">
              <p className="font-semibold">O cardápio ainda está vazio.</p>
              <p className="text-tinta-suave">
                {gestao
                  ? "Comece criando uma categoria, como Massas ou Bebidas, logo abaixo."
                  : "Peça ao gerente para cadastrar o cardápio."}
              </p>
            </div>
          )}
          {dados.categorias
            .filter((c) => c.ativa)
            .map((categoria) => (
              <CategoriaComItens
                key={categoria.id}
                categoria={categoria}
                itens={dados.itens.filter((i) => i.categoria_id === categoria.id)}
                gestao={gestao}
                mostraCusto={dados.mostra_custo}
                aoMudar={mudar}
                aoTemHoje={temHoje}
              />
            ))}
          {gestao && (
            <>
              <NovoItem
                categorias={dados.categorias.filter((c) => c.ativa)}
                restaurante={restaurante}
                mostraCusto={dados.mostra_custo}
                aoCriar={(nome) => {
                  setRecado({ tipo: "ok", texto: `${nome} adicionado ao cardápio.` });
                  recarregar();
                }}
                aoErrar={(texto) => setRecado({ tipo: "erro", texto })}
              />
              <NovaCategoria
                restaurante={restaurante}
                aoCriar={(nome) => {
                  setRecado({ tipo: "ok", texto: `Categoria ${nome} criada.` });
                  recarregar();
                }}
                aoErrar={(texto) => setRecado({ tipo: "erro", texto })}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

function CategoriaComItens({
  categoria,
  itens,
  gestao,
  mostraCusto,
  aoMudar,
  aoTemHoje,
}: {
  categoria: CategoriaCardapio;
  itens: ItemCardapio[];
  gestao: boolean;
  mostraCusto: boolean;
  aoMudar: (item: ItemCardapio, corpo: Record<string, unknown>, texto: string) => void;
  aoTemHoje: (item: ItemCardapio, disponivel: boolean) => Promise<boolean>;
}) {
  const ativos = itens.filter((i) => i.ativo);
  const fora = itens.filter((i) => !i.ativo);
  return (
    <section
      aria-labelledby={`categoria-${categoria.id}`}
      className="flex flex-col gap-2 rounded-2xl border border-linha bg-superficie p-4 md:p-5"
    >
      <h2 id={`categoria-${categoria.id}`} className="font-placa text-2xl font-bold">
        {categoria.nome}
      </h2>
      {ativos.length === 0 && <p className="text-tinta-suave">Nenhum item nesta categoria.</p>}
      <ul className="flex flex-col divide-y divide-linha">
        {ativos.map((item) => (
          <LinhaItem
            key={`${item.id}-${item.disponivel}`}
            item={item}
            gestao={gestao}
            mostraCusto={mostraCusto}
            aoMudar={aoMudar}
            aoTemHoje={aoTemHoje}
          />
        ))}
      </ul>
      {gestao && fora.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-tinta-suave">
            Fora do cardápio ({fora.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {fora.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3">
                <span className="text-tinta-suave">{item.nome}</span>
                <Botao
                  variante="secundario"
                  onClick={() =>
                    aoMudar(item, { ativo: true }, `${item.nome} voltou para o cardápio.`)
                  }
                >
                  Voltar ao cardápio
                </Botao>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function LinhaItem({
  item,
  gestao,
  mostraCusto,
  aoMudar,
  aoTemHoje,
}: {
  item: ItemCardapio;
  gestao: boolean;
  mostraCusto: boolean;
  aoMudar: (item: ItemCardapio, corpo: Record<string, unknown>, texto: string) => void;
  aoTemHoje: (item: ItemCardapio, disponivel: boolean) => Promise<boolean>;
}) {
  // A caixa muda na hora; se o servidor recusar, volta como estava.
  const [tem, setTem] = useState(item.disponivel);
  const lucro =
    item.custo_centavos !== null && item.preco_centavos > 0
      ? Math.round(((item.preco_centavos - item.custo_centavos) / item.preco_centavos) * 100)
      : null;

  function salvarPreco(texto: string) {
    const novo = centavosDoCampo(texto);
    if (novo === null || novo < 1 || novo === item.preco_centavos) return;
    aoMudar(
      item,
      { preco_centavos: novo },
      `Preço de ${item.nome} agora é ${preco(novo)}. Vale para os próximos pedidos.`,
    );
  }

  function salvarCusto(texto: string) {
    const novo = texto.trim() === "" ? null : centavosDoCampo(texto);
    if (texto.trim() !== "" && novo === null) return;
    if (novo === item.custo_centavos) return;
    aoMudar(item, { custo_centavos: novo }, `Custo de ${item.nome} salvo.`);
  }

  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
      data-testid={`item-${item.id}`}
    >
      <span
        className={`min-w-[10rem] flex-1 font-semibold ${tem ? "" : "text-tinta-suave line-through"}`}
      >
        {item.nome}
      </span>
      {gestao ? (
        <label className="flex items-center gap-2 text-sm text-tinta-suave">
          Preço R$
          <input
            id={`preco-${item.id}`}
            key={`preco-${item.preco_centavos}`}
            inputMode="decimal"
            defaultValue={campoDosCentavos(item.preco_centavos)}
            onBlur={(e) => salvarPreco(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label={`Preço de ${item.nome} em reais`}
            className="numeros min-h-10 w-20 rounded-lg border border-linha bg-superficie px-2 text-base text-tinta"
          />
        </label>
      ) : (
        <span className="numeros text-tinta-suave">{preco(item.preco_centavos)}</span>
      )}
      {mostraCusto && item.custo_pela_ficha && (
        <span className="flex items-center gap-2 text-sm text-tinta-suave">
          Custo{" "}
          <span className="numeros font-semibold text-tinta">
            {item.custo_centavos === null ? "sem preço" : preco(item.custo_centavos)}
          </span>
          <Link href="/estoque" className="underline underline-offset-2 hover:text-tinta">
            pela ficha
          </Link>
          <span className="numeros w-24 font-semibold text-tinta">
            {lucro === null ? "" : `lucro ${lucro}%`}
          </span>
        </span>
      )}
      {mostraCusto && !item.custo_pela_ficha && (
        <label className="flex items-center gap-2 text-sm text-tinta-suave">
          Custo R$
          <input
            id={`custo-${item.id}`}
            key={`custo-${item.custo_centavos}`}
            inputMode="decimal"
            defaultValue={campoDosCentavos(item.custo_centavos)}
            onBlur={(e) => salvarCusto(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label={`Custo de ${item.nome} em reais`}
            className="numeros min-h-10 w-20 rounded-lg border border-linha bg-superficie px-2 text-base text-tinta"
          />
          <span className="numeros w-24 font-semibold text-tinta">
            {lucro === null ? "" : `lucro ${lucro}%`}
          </span>
        </label>
      )}
      <label className="flex min-h-10 items-center gap-2 text-sm font-semibold">
        <input
          id={`tem-${item.id}`}
          type="checkbox"
          checked={tem}
          onChange={(e) => {
            const novo = e.target.checked;
            setTem(novo);
            aoTemHoje(item, novo).then((deu) => deu || setTem(!novo));
          }}
          className="size-5 accent-[var(--ocupada)]"
        />
        {tem ? "Tem hoje" : <span className="text-atrasada">Acabou</span>}
      </label>
      {gestao && (
        <button
          type="button"
          onClick={() => aoMudar(item, { ativo: false }, `${item.nome} saiu do cardápio.`)}
          className="text-sm font-semibold text-tinta-suave underline underline-offset-2 hover:text-tinta"
        >
          Tirar do cardápio
        </button>
      )}
    </li>
  );
}

function NovoItem({
  categorias,
  restaurante,
  mostraCusto,
  aoCriar,
  aoErrar,
}: {
  categorias: CategoriaCardapio[];
  restaurante: number;
  mostraCusto: boolean;
  aoCriar: (nome: string) => void;
  aoErrar: (texto: string) => void;
}) {
  if (categorias.length === 0) return null;

  async function criar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const form = new FormData(formulario);
    const nome = String(form.get("nome")).trim();
    const valor = centavosDoCampo(String(form.get("preco")));
    const custoTexto = String(form.get("custo") ?? "").trim();
    const custo = custoTexto ? centavosDoCampo(custoTexto) : null;
    if (valor === null || valor < 1)
      return aoErrar("Preço inválido. Use só números, como 62 ou 12,50.");
    if (custoTexto && custo === null)
      return aoErrar("Custo inválido. Use só números, como 18 ou 4,50.");
    try {
      await api("/api/cardapio/itens", {
        metodo: "POST",
        restaurante,
        corpo: {
          categoria_id: Number(form.get("categoria")),
          nome,
          preco_centavos: valor,
          ...(mostraCusto && custo !== null ? { custo_centavos: custo } : {}),
        },
      });
      formulario.reset();
      aoCriar(nome);
    } catch (e) {
      aoErrar((e as Error).message);
    }
  }

  return (
    <Secao titulo="Adicionar item">
      <form
        onSubmit={criar}
        className="grid gap-3 sm:grid-cols-[2fr_1.4fr_1fr_1fr_auto] sm:items-end"
      >
        <Campo
          rotulo="Nome"
          name="nome"
          id="novo-item-nome"
          required
          minLength={2}
          maxLength={80}
          placeholder="Ex.: Risoto de cogumelos"
        />
        <Selecao rotulo="Categoria" name="categoria" id="novo-item-categoria">
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Selecao>
        <Campo
          rotulo="Preço (R$)"
          name="preco"
          id="novo-item-preco"
          inputMode="decimal"
          required
          placeholder="64"
        />
        {mostraCusto ? (
          <Campo
            rotulo="Custo (R$)"
            name="custo"
            id="novo-item-custo"
            inputMode="decimal"
            placeholder="18"
          />
        ) : (
          <span />
        )}
        <Botao type="submit">Adicionar item</Botao>
      </form>
    </Secao>
  );
}

function NovaCategoria({
  restaurante,
  aoCriar,
  aoErrar,
}: {
  restaurante: number;
  aoCriar: (nome: string) => void;
  aoErrar: (texto: string) => void;
}) {
  async function criar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const form = new FormData(formulario);
    const nome = String(form.get("nome")).trim();
    try {
      await api("/api/cardapio/categorias", {
        metodo: "POST",
        restaurante,
        corpo: { nome, bebida: form.get("bebida") === "on", ordem: 99 },
      });
      formulario.reset();
      aoCriar(nome);
    } catch (e) {
      aoErrar((e as Error).message);
    }
  }

  return (
    <Secao
      titulo="Nova categoria"
      descricao="Marque quando for de bebida: assim os resultados separam o prato da noite da bebida da noite."
    >
      <form onSubmit={criar} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Campo
            rotulo="Nome da categoria"
            name="nome"
            id="nova-categoria-nome"
            required
            minLength={2}
            maxLength={60}
            placeholder="Ex.: Pizzas"
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 font-semibold">
          <input
            id="nova-categoria-bebida"
            name="bebida"
            type="checkbox"
            className="size-5 accent-[var(--ocupada)]"
          />
          É de bebida
        </label>
        <Botao type="submit" variante="secundario">
          Criar categoria
        </Botao>
      </form>
    </Secao>
  );
}
