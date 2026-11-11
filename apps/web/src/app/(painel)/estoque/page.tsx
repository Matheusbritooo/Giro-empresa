"use client";

import { useCallback, useState } from "react";

import { Aviso, Botao, Campo, Selecao } from "@/components/ui";
import { api } from "@/lib/api";
import { useSalaoAoVivo } from "@/lib/ao-vivo";
import { useDados } from "@/lib/dados";
import {
  baseDoCampo,
  campoDaBase,
  custoDaFicha,
  ordenarInsumos,
  dicaDaPerda,
  porcento,
  porPorcao,
  pratosQueUsam,
  precisaContar,
  precoDoInsumo,
  quando,
  quantidade,
  ROTULO_SITUACAO,
  situacaoDoInsumo,
  sugestoesDeAcabou,
  textoAteQuando,
  textoCompra,
  textoDaDiferenca,
  textoDaLista,
  textoDoMovimento,
  unidadeDoCampo,
} from "@/lib/estoque";
import { campoDosCentavos, centavosDoCampo, preco } from "@/lib/pedido";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { diaDaSemana, horaLocal, noiteDe, reais, rotuloDia } from "@/lib/resultados";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import {
  type AvisoAoVivo,
  type Cardapio,
  type Diferenca,
  type Estoque,
  type Ficha,
  type Insumo,
  type ItemCardapio,
  type LinhaDeCompra,
  type ListaDeCompras,
  type Perdas,
  MOTIVOS_PERDA,
  type Movimento,
  type UnidadeInsumo,
} from "@/lib/tipos";

function semAlerta() {}

type Recado = { tipo: "erro" | "ok"; texto: string } | null;
type Formulario = "compra" | "perda" | "contagem" | "novo" | null;

export default function PaginaEstoque() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const gestao = !!sessao && podeGerirMesas(sessao.usuario.papel);
  const veCusto = sessao?.usuario.papel === "dono" || sessao?.usuario.papel === "admin_giro";
  const buscarEstoque = useCallback(
    () => api<Estoque>("/api/estoque", { restaurante }),
    [restaurante],
  );
  const buscarCardapio = useCallback(
    () => api<Cardapio>("/api/cardapio", { restaurante }),
    [restaurante],
  );
  const {
    dados: estoque,
    erro,
    recarregar: recarregarEstoque,
  } = useDados(restaurante ? buscarEstoque : null);
  const { dados: cardapio, recarregar: recarregarCardapio } = useDados(
    restaurante ? buscarCardapio : null,
  );
  const [aba, setAba] = useState<"ingredientes" | "lista" | "perdas" | "fichas">("ingredientes");
  const [periodo, setPeriodo] = useState<"semana" | "mes">("semana");
  const buscarPerdas = useCallback(
    () => api<Perdas>(`/api/estoque/perdas?periodo=${periodo}`, { restaurante }),
    [restaurante, periodo],
  );
  const {
    dados: perdas,
    erro: erroPerdas,
    recarregar: recarregarPerdas,
  } = useDados(restaurante && veCusto && aba === "perdas" ? buscarPerdas : null);
  // A lista de compras (gerente e dono) busca junto e se atualiza com os mesmos avisos.
  const [folga, setFolga] = useState<number | null>(null);
  const buscarLista = useCallback(
    () =>
      api<ListaDeCompras>(`/api/estoque/compras${folga === null ? "" : `?folga=${folga}`}`, {
        restaurante,
      }),
    [restaurante, folga],
  );
  const {
    dados: lista,
    erro: erroLista,
    recarregar: recarregarLista,
  } = useDados(restaurante && gestao && aba === "lista" ? buscarLista : null);
  const aoAviso = useCallback(
    (aviso: AvisoAoVivo) => {
      if (aviso.tipo === "cardapio") recarregarCardapio();
      else {
        recarregarEstoque(); // pedido lançado ou cancelado mexe no estoque
        recarregarLista();
        recarregarPerdas();
      }
    },
    [recarregarCardapio, recarregarEstoque, recarregarLista, recarregarPerdas],
  );
  useSalaoAoVivo(restaurante, semAlerta, aoAviso);
  const [recado, setRecado] = useState<Recado>(null);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;

  const pronto = (texto: string) => {
    setRecado({ tipo: "ok", texto });
    recarregarEstoque();
    recarregarCardapio();
  };
  const falhou = (e: unknown) => setRecado({ tipo: "erro", texto: (e as Error).message });

  return (
    <>
      <h1 className="font-placa text-4xl font-extrabold leading-none">Estoque</h1>
      <p className="max-w-prose text-tinta-suave">
        Cada prato lançado tira do estoque o que a ficha dele diz.{" "}
        {gestao
          ? "Lance o que chegou, o que se perdeu e conte o estoque: a conta acompanha a geladeira."
          : "Jogou algo fora? Registre a perda aqui."}
      </p>
      <div
        role="tablist"
        aria-label="Partes do estoque"
        className="inline-flex max-w-full flex-wrap self-start rounded-xl border border-linha bg-superficie p-1"
      >
        {(
          [
            ["ingredientes", "Ingredientes"],
            ...(gestao ? ([["lista", "Lista de compras"]] as const) : []),
            ...(veCusto ? ([["perdas", "Perdas"]] as const) : []),
            ["fichas", "Fichas dos pratos"],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            id={`aba-${valor}`}
            aria-selected={aba === valor}
            aria-controls={`painel-${valor}`}
            onClick={() => {
              setAba(valor);
              setRecado(null);
            }}
            className={`min-h-10 rounded-lg px-4 font-semibold ${
              aba === valor ? "bg-tinta text-fundo" : "text-tinta-suave hover:text-tinta"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      <Aviso>{erro}</Aviso>

      {!estoque || !cardapio ? (
        !erro && <p className="text-tinta-suave">Abrindo o estoque...</p>
      ) : aba === "ingredientes" ? (
        <div role="tabpanel" id="painel-ingredientes" aria-labelledby="aba-ingredientes">
          <Ingredientes
            estoque={estoque}
            cardapio={cardapio}
            gestao={gestao}
            restaurante={restaurante}
            aoTerminar={pronto}
            aoErrar={falhou}
          />
        </div>
      ) : aba === "lista" ? (
        <div role="tabpanel" id="painel-lista" aria-labelledby="aba-lista">
          <Aviso>{erroLista}</Aviso>
          {lista ? (
            <ListaDaCompra
              lista={lista}
              restaurante={sessao?.restaurante?.nome ?? "restaurante"}
              aoMudarFolga={setFolga}
            />
          ) : (
            !erroLista && <p className="text-tinta-suave">Fazendo a conta da compra...</p>
          )}
        </div>
      ) : aba === "perdas" ? (
        <div role="tabpanel" id="painel-perdas" aria-labelledby="aba-perdas">
          <Aviso>{erroPerdas}</Aviso>
          {perdas ? (
            <PerdasDoEstoque perdas={perdas} aoMudarPeriodo={setPeriodo} />
          ) : (
            !erroPerdas && <p className="text-tinta-suave">Fazendo a conta das perdas...</p>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="painel-fichas" aria-labelledby="aba-fichas">
          <Fichas
            estoque={estoque}
            cardapio={cardapio}
            gestao={gestao}
            aoTerminar={pronto}
            aoErrar={falhou}
          />
        </div>
      )}
    </>
  );
}

// ---------- Ingredientes ----------

function Ingredientes({
  estoque,
  cardapio,
  gestao,
  restaurante,
  aoTerminar,
  aoErrar,
}: {
  estoque: Estoque;
  cardapio: Cardapio;
  gestao: boolean;
  restaurante: number;
  aoTerminar: (texto: string) => void;
  aoErrar: (e: unknown) => void;
}) {
  const [aberto, setAberto] = useState<Formulario>(null);
  const [livro, setLivro] = useState<number | null>(null);
  const ativos = ordenarInsumos(estoque.insumos.filter((i) => i.ativo));
  const foraDeUso = estoque.insumos.filter((i) => !i.ativo);
  const sugestoes = sugestoesDeAcabou(estoque.insumos, estoque.fichas, cardapio.itens);
  const contando = aberto === "contagem";

  function alternar(qual: Formulario) {
    setAberto((atual) => (atual === qual ? null : qual));
  }
  function terminar(texto: string) {
    setAberto(null);
    aoTerminar(texto);
  }

  async function marcarAcabou(item: ItemCardapio) {
    try {
      await api(`/api/cardapio/itens/${item.id}/disponivel`, {
        metodo: "POST",
        corpo: { disponivel: false },
      });
      aoTerminar(`${item.nome} marcado como acabou. Os garçons já veem riscado.`);
    } catch (e) {
      aoErrar(e);
    }
  }

  async function salvarContagem(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = new FormData(evento.currentTarget);
    const itens: { insumo_id: number; quantidade: number }[] = [];
    for (const insumo of ativos) {
      const texto = String(form.get(`contei-${insumo.id}`) ?? "").trim();
      if (!texto) continue;
      const base = baseDoCampo(insumo.unidade, texto);
      if (base === null) {
        aoErrar(new Error(`${insumo.nome}: use só números, como 3 ou 2,5.`));
        return;
      }
      itens.push({ insumo_id: insumo.id, quantidade: base });
    }
    if (itens.length === 0) {
      aoErrar(new Error("Escreva o que contou em pelo menos um ingrediente."));
      return;
    }
    try {
      const resposta = await api<{ diferencas: Diferenca[] }>("/api/estoque/contagens", {
        metodo: "POST",
        restaurante,
        corpo: { itens },
      });
      terminar(`Contagem salva. ${resposta.diferencas.map(textoDaDiferenca).join(" ")}`);
    } catch (e) {
      aoErrar(e);
    }
  }

  const hoje = estoque.hoje;
  const vaoFaltar = ativos.filter((i) => situacaoDoInsumo(i) === "vai_faltar").length;
  const naLista = ativos.filter((i) => situacaoDoInsumo(i) === "comprar").length;
  const contar = gestao ? ativos.filter((i) => precisaContar(i, hoje)) : [];

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose">
        <b>
          Próxima compra: {rotuloDia(estoque.proxima_compra)}
          {perto(estoque.proxima_compra, hoje)}.
        </b>{" "}
        <span className="text-tinta-suave">
          Ela cobre {juntar(estoque.cobre.map(diaDaSemana))}.{" "}
          {vaoFaltar > 0 &&
            `${vaoFaltar} ${vaoFaltar === 1 ? "ingrediente vai" : "ingredientes vão"} faltar antes dela. `}
          {naLista > 0 && `${naLista} ${naLista === 1 ? "entra" : "entram"} na lista de compras.`}
        </span>
      </p>
      {contar.length > 0 && (
        <p className="max-w-prose rounded-xl border-l-4 border-aguardando bg-superficie px-4 py-3">
          <b>Hora de contar:</b> {contar.map((i) => i.nome.toLowerCase()).join(", ")}. São da curva
          A (os que mais pesam no bolso) e não são contados há mais de uma semana.
        </p>
      )}
      {sugestoes.map(({ insumo, pratos }) => (
        <div
          key={insumo.id}
          className="flex flex-col gap-2 rounded-xl border-l-4 border-atrasada bg-superficie p-4"
        >
          <p>
            <b>{insumo.nome}</b> zerou pela conta, mas ainda aparece para os garçons em{" "}
            {pratos.map((p) => p.nome).join(", ")}. Confira na geladeira: a conta pode estar errada.
          </p>
          <div className="flex flex-wrap gap-2">
            {pratos.map((p) => (
              <Botao key={p.id} variante="secundario" onClick={() => marcarAcabou(p)}>
                Marcar {p.nome} como acabou
              </Botao>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {gestao && (
          <Botao aria-expanded={aberto === "compra"} onClick={() => alternar("compra")}>
            Chegou compra
          </Botao>
        )}
        <Botao
          variante={gestao ? "secundario" : "principal"}
          aria-expanded={aberto === "perda"}
          onClick={() => alternar("perda")}
        >
          Registrar perda
        </Botao>
        {gestao && (
          <Botao
            variante="secundario"
            aria-expanded={contando}
            onClick={() => alternar("contagem")}
          >
            {contando ? "Cancelar contagem" : "Contar estoque"}
          </Botao>
        )}
        {gestao && (
          <Botao
            variante="secundario"
            aria-expanded={aberto === "novo"}
            onClick={() => alternar("novo")}
          >
            Novo ingrediente
          </Botao>
        )}
      </div>

      {aberto === "compra" && (
        <FormCompra
          insumos={ativos}
          mostraValores={estoque.mostra_valores}
          aoTerminar={terminar}
          aoErrar={aoErrar}
        />
      )}
      {aberto === "perda" && <FormPerda insumos={ativos} aoTerminar={terminar} aoErrar={aoErrar} />}
      {aberto === "novo" && (
        <FormNovoInsumo restaurante={restaurante} aoTerminar={terminar} aoErrar={aoErrar} />
      )}

      {ativos.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-linha p-6">
          <p className="font-semibold">Nenhum ingrediente no estoque ainda.</p>
          <p className="text-tinta-suave">
            {gestao
              ? "Comece pelos que pesam no bolso: carnes, queijos, massas e bebidas. Toque em Novo ingrediente."
              : "Peça ao gerente para cadastrar os ingredientes."}
          </p>
        </div>
      ) : (
        <form onSubmit={salvarContagem} className="flex flex-col gap-3">
          {contando && (
            <p className="rounded-lg border-l-4 border-ocupada bg-superficie px-3 py-2 text-sm">
              Conte o que tem na prateleira e na geladeira e escreva ao lado. Deixe em branco o que
              não contou. O que você contar substitui a conta do sistema.
            </p>
          )}
          <div className="relative overflow-x-auto rounded-xl border border-linha bg-superficie">
            <table className="numeros w-full text-left text-sm">
              <thead className="text-tinta-suave">
                <tr className="border-b border-linha">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Ingrediente
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    {contando ? "Pela conta" : "Tem"}
                  </th>
                  {!contando && (
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Até quando
                    </th>
                  )}
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {contando ? "Contei" : "Situação"}
                  </th>
                  {estoque.mostra_valores && !contando && (
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Preço médio
                    </th>
                  )}
                  {gestao && !contando && (
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">Livro</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {ativos.map((insumo) => (
                  <LinhaInsumo
                    key={insumo.id}
                    insumo={insumo}
                    contando={contando}
                    mostraValores={estoque.mostra_valores}
                    gestao={gestao}
                    hoje={hoje}
                    livroAberto={livro === insumo.id}
                    aoAbrirLivro={() => setLivro((l) => (l === insumo.id ? null : insumo.id))}
                    usadoEm={pratosQueUsam(insumo.id, estoque.fichas, cardapio.itens)}
                    aoTerminar={aoTerminar}
                    aoErrar={aoErrar}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {contando && (
            <Botao type="submit" className="self-start">
              Salvar contagem
            </Botao>
          )}
        </form>
      )}

      {gestao && foraDeUso.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-tinta-suave">
            Fora de uso ({foraDeUso.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {foraDeUso.map((insumo) => (
              <li key={insumo.id} className="flex items-center justify-between gap-3">
                <span className="text-tinta-suave">{insumo.nome}</span>
                <Botao
                  variante="secundario"
                  onClick={() =>
                    api(`/api/estoque/insumos/${insumo.id}`, {
                      metodo: "PATCH",
                      corpo: { ativo: true },
                    }).then(() => aoTerminar(`${insumo.nome} voltou para o estoque.`), aoErrar)
                  }
                >
                  Voltar a usar
                </Botao>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const SELOS = {
  // Urgente: cor, padrão hachurado e palavra, nunca só cor.
  zerado: "hachurado bg-atrasada text-sobre-cor",
  vai_faltar: "hachurado bg-atrasada text-sobre-cor",
  comprar: "bg-aguardando text-sobre-aguardando",
  tem: "border border-linha text-tinta-suave",
} as const;

function SeloSituacao({ insumo }: { insumo: Insumo }) {
  const situacao = situacaoDoInsumo(insumo);
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${SELOS[situacao]}`}
    >
      {ROTULO_SITUACAO[situacao]}
    </span>
  );
}

function LinhaInsumo({
  insumo,
  contando,
  mostraValores,
  gestao,
  hoje,
  livroAberto,
  aoAbrirLivro,
  usadoEm,
  aoTerminar,
  aoErrar,
}: {
  insumo: Insumo;
  contando: boolean;
  mostraValores: boolean;
  gestao: boolean;
  hoje: string;
  livroAberto: boolean;
  aoAbrirLivro: () => void;
  usadoEm: ItemCardapio[];
  aoTerminar: (texto: string) => void;
  aoErrar: (e: unknown) => void;
}) {
  const colunas = 4 + (mostraValores ? 1 : 0) + (gestao ? 1 : 0);
  return (
    <>
      <tr className="border-b border-linha last:border-b-0" data-testid={`insumo-${insumo.id}`}>
        <th scope="row" className="px-4 py-3 font-semibold">
          {insumo.nome}
          {gestao && insumo.curva === "A" && (
            <span className="ml-2 rounded border border-linha px-1.5 text-xs font-bold text-tinta-suave">
              curva A
            </span>
          )}
          {usadoEm.length > 0 && (
            <span className="block text-xs font-normal text-tinta-suave">
              vai em {usadoEm.length} {usadoEm.length === 1 ? "prato" : "pratos"}
            </span>
          )}
        </th>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          {quantidade(insumo.unidade, insumo.saldo)}
        </td>
        {!contando && (
          <td className="whitespace-nowrap px-4 py-3 text-tinta-suave">
            {textoAteQuando(insumo, hoje)}
          </td>
        )}
        <td className="px-4 py-3">
          {contando ? (
            <label className="flex items-center gap-2 text-tinta-suave">
              <input
                id={`contei-${insumo.id}`}
                name={`contei-${insumo.id}`}
                inputMode="decimal"
                aria-label={`Contei de ${insumo.nome}, em ${unidadeDoCampo(insumo.unidade)}`}
                className="numeros min-h-10 w-24 rounded-lg border border-linha bg-superficie px-2 text-base text-tinta"
              />
              {unidadeDoCampo(insumo.unidade)}
            </label>
          ) : (
            <SeloSituacao insumo={insumo} />
          )}
        </td>
        {mostraValores && !contando && (
          <td className="whitespace-nowrap px-4 py-3 text-tinta-suave">
            {precoDoInsumo(insumo) ?? "sem preço"}
          </td>
        )}
        {gestao && !contando && (
          <td className="px-4 py-3 text-right">
            <button
              type="button"
              onClick={aoAbrirLivro}
              aria-expanded={livroAberto}
              className="whitespace-nowrap font-semibold text-tinta-suave underline underline-offset-2 hover:text-tinta"
            >
              {livroAberto ? "Fechar" : "Ver livro"}
            </button>
          </td>
        )}
      </tr>
      {livroAberto && !contando && (
        <tr className="border-b border-linha bg-fundo">
          <td colSpan={colunas} className="px-4 py-4">
            <Livro insumo={insumo} aoTerminar={aoTerminar} aoErrar={aoErrar} />
          </td>
        </tr>
      )}
    </>
  );
}

function Livro({
  insumo,
  aoTerminar,
  aoErrar,
}: {
  insumo: Insumo;
  aoTerminar: (texto: string) => void;
  aoErrar: (e: unknown) => void;
}) {
  const buscar = useCallback(
    () => api<Movimento[]>(`/api/estoque/insumos/${insumo.id}/movimentos`),
    [insumo.id],
  );
  const { dados, erro } = useDados(buscar);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-tinta-suave">
        Tudo o que entrou e saiu de {insumo.nome.toLowerCase()}, do mais novo para o mais antigo.
        Nada se apaga: quem errou faz outro lançamento.
      </p>
      <Aviso>{erro}</Aviso>
      {!dados ? (
        !erro && <p className="text-tinta-suave">Abrindo o livro...</p>
      ) : dados.length === 0 ? (
        <p className="text-tinta-suave">Nada lançado ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-linha">
          {dados.map((m) => (
            <li key={m.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
              <span className="w-36 text-tinta-suave">
                {rotuloDia(noiteDe(Date.parse(m.em)))}, {horaLocal(m.em)}
              </span>
              <span className="min-w-40 flex-1 font-semibold">{textoDoMovimento(m)}</span>
              <span className={m.quantidade < 0 ? "text-atrasada" : ""}>
                {m.quantidade > 0 ? "+" : m.quantidade < 0 ? "−" : ""}
                {quantidade(insumo.unidade, Math.abs(m.quantidade))}
              </span>
              <span className="text-tinta-suave">
                ficou {quantidade(insumo.unidade, m.saldo_depois)}
                {m.valor_centavos !== null && `, nota de ${preco(m.valor_centavos)}`}
                {m.quem && `, por ${m.quem}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Botao
        variante="secundario"
        className="self-start"
        onClick={() =>
          api(`/api/estoque/insumos/${insumo.id}`, {
            metodo: "PATCH",
            corpo: { ativo: false },
          }).then(
            () => aoTerminar(`${insumo.nome} saiu do estoque. O livro continua guardado.`),
            aoErrar,
          )
        }
      >
        Tirar do estoque
      </Botao>
    </div>
  );
}

function useInsumoEscolhido(insumos: Insumo[]) {
  const [id, setId] = useState<number | null>(insumos[0]?.id ?? null);
  const insumo = insumos.find((i) => i.id === id) ?? insumos[0] ?? null;
  return { insumo, setId };
}

function FormCompra({
  insumos,
  mostraValores,
  aoTerminar,
  aoErrar,
}: {
  insumos: Insumo[];
  mostraValores: boolean;
  aoTerminar: (texto: string) => void;
  aoErrar: (e: unknown) => void;
}) {
  const { insumo, setId } = useInsumoEscolhido(insumos);
  if (!insumo) return null;

  async function registrar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!insumo) return;
    const form = new FormData(evento.currentTarget);
    const base = baseDoCampo(insumo.unidade, String(form.get("quantidade")));
    const valorTexto = String(form.get("valor") ?? "").trim();
    const valor = valorTexto ? centavosDoCampo(valorTexto) : null;
    if (base === null || base < 1)
      return aoErrar(new Error("Quantidade inválida. Use só números, como 10 ou 2,5."));
    if (valorTexto && valor === null)
      return aoErrar(new Error("Valor inválido. Use só números, como 430 ou 89,90."));
    try {
      await api("/api/estoque/compras", {
        metodo: "POST",
        corpo: {
          insumo_id: insumo.id,
          quantidade: base,
          valor_centavos: valor,
        },
      });
      aoTerminar(
        `Compra registrada: ${quantidade(insumo.unidade, base)} de ${insumo.nome.toLowerCase()}.`,
      );
    } catch (e) {
      aoErrar(e);
    }
  }

  return (
    <form
      onSubmit={registrar}
      className="flex flex-col gap-3 rounded-xl border-2 border-dashed border-ocupada p-4"
    >
      <h2 className="font-placa text-2xl font-bold">Chegou compra</h2>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] sm:items-end">
        <Selecao
          rotulo="Ingrediente"
          id="compra-insumo"
          value={insumo.id}
          onChange={(e) => setId(Number(e.target.value))}
        >
          {insumos.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nome}
            </option>
          ))}
        </Selecao>
        <Campo
          key={`q-${insumo.id}`}
          rotulo={`Quantidade (${unidadeDoCampo(insumo.unidade)})`}
          name="quantidade"
          id="compra-quantidade"
          inputMode="decimal"
          required
          defaultValue={campoDaBase(insumo.unidade, insumo.embalagem_quantidade)}
          ajuda={insumo.embalagem_nome ? `Embalagem: ${insumo.embalagem_nome}` : undefined}
        />
        {mostraValores && (
          <Campo
            rotulo="Valor da nota (R$)"
            name="valor"
            id="compra-valor"
            inputMode="decimal"
            placeholder="430"
            ajuda="O preço do ingrediente vira a média com o que já tinha."
          />
        )}
      </div>
      <Botao type="submit" className="self-start">
        Registrar compra
      </Botao>
    </form>
  );
}

function FormPerda({
  insumos,
  aoTerminar,
  aoErrar,
}: {
  insumos: Insumo[];
  aoTerminar: (texto: string) => void;
  aoErrar: (e: unknown) => void;
}) {
  const { insumo, setId } = useInsumoEscolhido(insumos);
  if (!insumo) return null;

  async function registrar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!insumo) return;
    const form = new FormData(evento.currentTarget);
    const base = baseDoCampo(insumo.unidade, String(form.get("quantidade")));
    const motivo = String(form.get("motivo"));
    if (base === null || base < 1)
      return aoErrar(new Error("Quantidade inválida. Use só números, como 1 ou 0,5."));
    try {
      await api("/api/estoque/perdas", {
        metodo: "POST",
        corpo: { insumo_id: insumo.id, quantidade: base, motivo },
      });
      aoTerminar(
        `Perda registrada: ${quantidade(insumo.unidade, base)} de ${insumo.nome.toLowerCase()} (${motivo}).`,
      );
    } catch (e) {
      aoErrar(e);
    }
  }

  return (
    <form
      onSubmit={registrar}
      className="flex flex-col gap-3 rounded-xl border-2 border-dashed border-ocupada p-4"
    >
      <h2 className="font-placa text-2xl font-bold">Registrar perda</h2>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] sm:items-end">
        <Selecao
          rotulo="Ingrediente"
          id="perda-insumo"
          value={insumo.id}
          onChange={(e) => setId(Number(e.target.value))}
        >
          {insumos.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nome}
            </option>
          ))}
        </Selecao>
        <Campo
          rotulo={`Quantidade (${unidadeDoCampo(insumo.unidade)})`}
          name="quantidade"
          id="perda-quantidade"
          inputMode="decimal"
          required
        />
        <Selecao rotulo="Motivo" name="motivo" id="perda-motivo" defaultValue="Estragou">
          {MOTIVOS_PERDA.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Selecao>
      </div>
      <p className="text-sm text-tinta-suave">
        Fica registrado quem lançou e quando. O motivo é da lista para virar número no fim do mês.
      </p>
      <Botao type="submit" className="self-start">
        Registrar perda
      </Botao>
    </form>
  );
}

const UNIDADES: { valor: UnidadeInsumo; texto: string }[] = [
  { valor: "g", texto: "Peso (kg)" },
  { valor: "ml", texto: "Volume (litro)" },
  { valor: "un", texto: "Unidade (lata, garrafa)" },
];

function FormNovoInsumo({
  restaurante,
  aoTerminar,
  aoErrar,
}: {
  restaurante: number;
  aoTerminar: (texto: string) => void;
  aoErrar: (e: unknown) => void;
}) {
  const [unidade, setUnidade] = useState<UnidadeInsumo>("g");
  const medida = unidadeDoCampo(unidade);

  async function criar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = new FormData(evento.currentTarget);
    const nome = String(form.get("nome")).trim();
    const embalagem = baseDoCampo(unidade, String(form.get("embalagem") || "1"));
    const temTexto = String(form.get("tem") ?? "").trim();
    const tem = temTexto ? baseDoCampo(unidade, temTexto) : null;
    const precoTexto = String(form.get("preco") ?? "").trim();
    const custo = precoTexto ? centavosDoCampo(precoTexto) : null;
    if (embalagem === null || embalagem < 1)
      return aoErrar(new Error("Embalagem inválida. Use só números, como 1 ou 0,5."));
    if (temTexto && tem === null)
      return aoErrar(new Error("Quanto tem agora: use só números, como 3 ou 2,5."));
    if (precoTexto && custo === null)
      return aoErrar(new Error("Preço inválido. Use só números, como 42 ou 2,60."));
    try {
      await api("/api/estoque/insumos", {
        metodo: "POST",
        restaurante,
        corpo: {
          nome,
          unidade,
          embalagem_quantidade: embalagem,
          embalagem_nome: String(form.get("embalagem_nome") ?? "").trim() || null,
          onde_compra: String(form.get("onde") ?? "").trim() || null,
          custo_centavos: custo,
          saldo: tem,
        },
      });
      aoTerminar(`${nome} entrou no estoque.`);
    } catch (e) {
      aoErrar(e);
    }
  }

  return (
    <form
      onSubmit={criar}
      className="flex flex-col gap-3 rounded-xl border-2 border-dashed border-ocupada p-4"
    >
      <h2 className="font-placa text-2xl font-bold">Novo ingrediente</h2>
      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <Campo
          rotulo="Nome"
          name="nome"
          id="novo-insumo-nome"
          required
          minLength={2}
          maxLength={60}
          placeholder="Ex.: Muçarela"
        />
        <Selecao
          rotulo="Como se mede"
          id="novo-insumo-unidade"
          value={unidade}
          onChange={(e) => setUnidade(e.target.value as UnidadeInsumo)}
        >
          {UNIDADES.map((u) => (
            <option key={u.valor} value={u.valor}>
              {u.texto}
            </option>
          ))}
        </Selecao>
        <Campo
          rotulo="Onde compra"
          name="onde"
          id="novo-insumo-onde"
          maxLength={40}
          placeholder="Ex.: Laticínios"
        />
        <Campo
          rotulo={`Vem em embalagem de (${medida})`}
          name="embalagem"
          id="novo-insumo-embalagem"
          inputMode="decimal"
          placeholder="1"
        />
        <Campo
          rotulo="Nome da embalagem"
          name="embalagem_nome"
          id="novo-insumo-embalagem-nome"
          maxLength={40}
          placeholder="Ex.: pacote de 1 kg"
        />
        <Campo
          rotulo={`Preço (R$ por ${unidade === "g" ? "kg" : unidade === "ml" ? "litro" : "unidade"})`}
          name="preco"
          id="novo-insumo-preco"
          inputMode="decimal"
          placeholder="42"
        />
        <Campo
          rotulo={`Tem agora (${medida})`}
          name="tem"
          id="novo-insumo-tem"
          inputMode="decimal"
          placeholder="3,5"
          ajuda="Vira a primeira contagem."
        />
      </div>
      <Botao type="submit" className="self-start">
        Pôr no estoque
      </Botao>
    </form>
  );
}

// ---------- Fichas dos pratos ----------

function Fichas({
  estoque,
  cardapio,
  gestao,
  aoTerminar,
  aoErrar,
}: {
  estoque: Estoque;
  cardapio: Cardapio;
  gestao: boolean;
  aoTerminar: (texto: string) => void;
  aoErrar: (e: unknown) => void;
}) {
  const itens = cardapio.itens.filter((i) => i.ativo);
  const fichaDe = (id: number) => estoque.fichas.find((f) => f.item_id === id) ?? null;
  const comFicha = itens.filter((i) => fichaDe(i.id));
  const semFicha = itens.filter((i) => !fichaDe(i.id));
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const item = itens.find((i) => i.id === escolhido) ?? comFicha[0] ?? itens[0] ?? null;

  if (!item) {
    return (
      <div className="rounded-xl border-2 border-dashed border-linha p-6">
        <p className="font-semibold">O cardápio ainda está vazio.</p>
        <p className="text-tinta-suave">Cadastre os pratos no Cardápio para montar as fichas.</p>
      </div>
    );
  }
  const ficha = fichaDe(item.id);

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-tinta-suave">
        A ficha diz quanto de cada ingrediente vai em uma porção.{" "}
        {gestao
          ? "Prato sem ficha não mexe no estoque. Comece pelos que mais vendem."
          : "Servir a mesma porção todo dia é o jeito mais barato de evitar desperdício."}
      </p>
      <div className="max-w-md">
        <Selecao
          rotulo="Prato"
          id="ficha-prato"
          value={item.id}
          onChange={(e) => setEscolhido(Number(e.target.value))}
        >
          <optgroup label={`Com ficha (${comFicha.length})`}>
            {comFicha.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome}
              </option>
            ))}
          </optgroup>
          <optgroup label={`Sem ficha (${semFicha.length})`}>
            {semFicha.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome}
              </option>
            ))}
          </optgroup>
        </Selecao>
      </div>
      <EditorFicha
        key={`${item.id}-${JSON.stringify(ficha)}`}
        item={item}
        ficha={ficha}
        estoque={estoque}
        gestao={gestao}
        aoTerminar={aoTerminar}
        aoErrar={aoErrar}
      />
    </div>
  );
}

type LinhaEditada = { chave: number; insumo_id: number; texto: string };

function EditorFicha({
  item,
  ficha,
  estoque,
  gestao,
  aoTerminar,
  aoErrar,
}: {
  item: ItemCardapio;
  ficha: Ficha | null;
  estoque: Estoque;
  gestao: boolean;
  aoTerminar: (texto: string) => void;
  aoErrar: (e: unknown) => void;
}) {
  const insumos = estoque.insumos;
  const nome = (id: number) => insumos.find((i) => i.id === id);
  const [linhas, setLinhas] = useState<LinhaEditada[]>(
    (ficha?.linhas ?? []).map((l, chave) => ({
      chave,
      insumo_id: l.insumo_id,
      texto: String(l.quantidade),
    })),
  );
  const [outros, setOutros] = useState(campoDosCentavos(ficha?.custo_outros_centavos ?? null));
  const mostraCusto = estoque.mostra_custo;

  const validas = linhas
    .map((l) => ({ insumo_id: l.insumo_id, quantidade: Number(l.texto) }))
    .filter((l) => Number.isInteger(l.quantidade) && l.quantidade > 0);
  const outrosCentavos = outros.trim() ? centavosDoCampo(outros) : null;
  const custo = custoDaFicha(validas, insumos, outrosCentavos);
  const livres = insumos.filter((i) => i.ativo && !linhas.some((l) => l.insumo_id === i.id));

  if (!gestao) {
    return (
      <section aria-labelledby="ficha-titulo" className="flex flex-col gap-3">
        <h2 id="ficha-titulo" className="font-placa text-2xl font-bold">
          {item.nome}
        </h2>
        {ficha ? (
          <ul className="flex max-w-md flex-col divide-y divide-linha rounded-xl border border-linha bg-superficie">
            {ficha.linhas.map((l) => {
              const insumo = nome(l.insumo_id);
              return (
                <li key={l.insumo_id} className="flex justify-between gap-4 px-4 py-3">
                  <span>{insumo?.nome ?? "Ingrediente"}</span>
                  <span className="numeros font-semibold">
                    {insumo ? porPorcao(insumo.unidade, l.quantidade) : l.quantidade}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-tinta-suave">Este prato ainda não tem ficha.</p>
        )}
      </section>
    );
  }

  async function salvar() {
    if (validas.length !== linhas.length)
      return aoErrar(new Error("Quantidade por prato: use número inteiro, como 120."));
    if (outros.trim() && outrosCentavos === null)
      return aoErrar(new Error("Outros: use só números, como 3,50."));
    try {
      const salva = await api<Ficha>(`/api/cardapio/itens/${item.id}/ficha`, {
        metodo: "POST",
        corpo: {
          linhas: validas,
          ...(mostraCusto ? { custo_outros_centavos: outrosCentavos } : {}),
        },
      });
      aoTerminar(
        validas.length === 0
          ? `${item.nome} ficou sem ficha: não mexe mais no estoque.`
          : `Ficha de ${item.nome} salva.${
              mostraCusto && salva.custo_centavos !== null
                ? ` O custo do prato agora é ${preco(salva.custo_centavos)}.`
                : ""
            }`,
      );
    } catch (e) {
      aoErrar(e);
    }
  }

  return (
    <section aria-labelledby="ficha-titulo" className="flex flex-col gap-3">
      <h2 id="ficha-titulo" className="font-placa text-2xl font-bold">
        {item.nome}
      </h2>
      {linhas.length === 0 && (
        <p className="text-tinta-suave">
          Sem ficha. Adicione os ingredientes que pesam no custo; tempero e óleo entram em
          &quot;outros&quot;.
        </p>
      )}
      {linhas.length > 0 && (
        <div className="relative overflow-x-auto rounded-xl border border-linha bg-superficie">
          <table className="numeros w-full text-left text-sm">
            <thead className="text-tinta-suave">
              <tr className="border-b border-linha">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Ingrediente
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Por prato
                </th>
                {mostraCusto && (
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Custo
                  </th>
                )}
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Tirar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => {
                const insumo = nome(linha.insumo_id);
                const q = Number(linha.texto);
                const custoLinha =
                  insumo && insumo.custo_centavos !== null && q > 0
                    ? (q * insumo.custo_centavos) / (insumo.unidade === "un" ? 1 : 1000)
                    : null;
                return (
                  <tr key={linha.chave} className="border-b border-linha last:border-b-0">
                    <td className="px-4 py-2">
                      <select
                        id={`ficha-insumo-${linha.chave}`}
                        aria-label="Ingrediente"
                        value={linha.insumo_id}
                        onChange={(e) =>
                          setLinhas((ls) =>
                            ls.map((l) =>
                              l.chave === linha.chave
                                ? { ...l, insumo_id: Number(e.target.value) }
                                : l,
                            ),
                          )
                        }
                        className="min-h-10 w-full min-w-40 rounded-lg border border-linha bg-superficie px-2 text-base text-tinta"
                      >
                        {[insumo, ...livres]
                          .filter((i): i is Insumo => !!i)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.nome}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <label className="flex items-center gap-2 text-tinta-suave">
                        <input
                          id={`ficha-quantidade-${linha.chave}`}
                          inputMode="numeric"
                          value={linha.texto}
                          onChange={(e) =>
                            setLinhas((ls) =>
                              ls.map((l) =>
                                l.chave === linha.chave ? { ...l, texto: e.target.value } : l,
                              ),
                            )
                          }
                          aria-label={`${insumo?.nome ?? "Ingrediente"} por prato, em ${insumo?.unidade ?? ""}`}
                          className="numeros min-h-10 w-20 rounded-lg border border-linha bg-superficie px-2 text-base text-tinta"
                        />
                        {insumo?.unidade}
                      </label>
                    </td>
                    {mostraCusto && (
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {custoLinha === null ? "sem preço" : preco(Math.round(custoLinha))}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setLinhas((ls) => ls.filter((l) => l.chave !== linha.chave))}
                        className="font-semibold text-tinta-suave underline underline-offset-2 hover:text-tinta"
                      >
                        Tirar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        {livres.length > 0 && (
          <Botao
            variante="secundario"
            onClick={() =>
              setLinhas((ls) => [
                ...ls,
                {
                  chave: Math.max(-1, ...ls.map((l) => l.chave)) + 1,
                  insumo_id: livres[0].id,
                  texto: "",
                },
              ])
            }
          >
            Adicionar ingrediente
          </Botao>
        )}
        {mostraCusto && (
          <div className="w-48">
            <Campo
              rotulo="Outros (R$)"
              id="ficha-outros"
              inputMode="decimal"
              value={outros}
              onChange={(e) => setOutros(e.target.value)}
              placeholder="3,50"
              ajuda="Tempero, óleo, guarnição."
            />
          </div>
        )}
      </div>
      {mostraCusto && (
        <p className="numeros text-lg">
          Custo pela ficha:{" "}
          <b>{custo === null ? "falta o preço de algum ingrediente" : preco(custo)}</b>
          {custo !== null && item.preco_centavos > 0 && (
            <span className="text-tinta-suave">
              {" "}
              de {preco(item.preco_centavos)} no cardápio (lucro de{" "}
              {Math.round(((item.preco_centavos - custo) / item.preco_centavos) * 100)}
              %)
            </span>
          )}
        </p>
      )}
      <Botao className="self-start" onClick={salvar}>
        Salvar ficha
      </Botao>
    </section>
  );
}

// ---------- Lista de compras ----------

/** " (hoje)" ou " (amanhã)"; mais longe, a data já diz tudo. */
function perto(dia: string, hoje: string): string {
  const q = quando(dia, hoje);
  return q === "hoje" || q === "amanhã" ? ` (${q})` : "";
}

/** "sexta, sábado e domingo". */
function juntar(partes: string[]): string {
  return partes.length <= 1
    ? (partes[0] ?? "")
    : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

function ListaDaCompra({
  lista,
  restaurante,
  aoMudarFolga,
}: {
  lista: ListaDeCompras;
  restaurante: string;
  aoMudarFolga: (folga: number | null) => void;
}) {
  const [copia, setCopia] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const folgas = [...new Set([10, lista.folga_padrao_pct, 25, 40])].sort((a, b) => a - b);
  const grupos = new Map<string, LinhaDeCompra[]>();
  for (const linha of lista.comprar) {
    const onde = linha.onde_compra ?? "Outros";
    grupos.set(onde, [...(grupos.get(onde) ?? []), linha]);
  }
  const noitesAntes = juntar(lista.antes.map(diaDaSemana));

  async function copiar() {
    const texto = textoDaLista(lista, restaurante);
    try {
      await navigator.clipboard.writeText(texto);
      setCopia(null);
      setCopiado(true);
    } catch {
      setCopia(texto); // sem permissão para copiar: mostra o texto para selecionar
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-prose">
          <h2 className="font-placa text-3xl font-extrabold leading-none">
            Compra de {rotuloDia(lista.compra)} {perto(lista.compra, lista.hoje)}
          </h2>
          <p className="text-tinta-suave">
            Cobre {juntar(lista.cobre.map(diaDaSemana))}.
            {lista.antes.length > 0 &&
              ` Até lá ainda saem ${noitesAntes}: a conta já desconta o que vai sair.`}{" "}
            Toque num item para ver de onde saiu o número.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Folga">
          <span className="text-sm text-tinta-suave">Folga</span>
          {folgas.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={lista.folga_pct === f}
              onClick={() => aoMudarFolga(f === lista.folga_padrao_pct ? null : f)}
              className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${
                lista.folga_pct === f
                  ? "border-tinta bg-fundo text-tinta"
                  : "border-linha bg-superficie text-tinta-suave"
              }`}
            >
              {f}%{f === lista.folga_padrao_pct ? " (padrão)" : ""}
            </button>
          ))}
        </div>
      </header>

      {lista.comprar.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-linha p-6">
          <p className="font-semibold">Pela conta, não falta nada para esta compra.</p>
          <p className="text-tinta-suave">Confira a geladeira mesmo assim: a conta pode errar.</p>
        </div>
      ) : (
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          {[...grupos]
            .sort(([a], [b]) =>
              a === "Outros" ? 1 : b === "Outros" ? -1 : a.localeCompare(b, "pt-BR"),
            )
            .map(([onde, linhas]) => (
              <section key={onde} aria-label={onde} className="flex flex-col">
                <h3 className="border-b-2 border-tinta pb-1 font-placa text-xl font-bold">
                  {onde}
                </h3>
                {linhas.map((linha) => (
                  <LinhaDaLista
                    key={linha.insumo_id}
                    linha={linha}
                    folga={lista.folga_pct}
                    noitesAntes={noitesAntes}
                  />
                ))}
              </section>
            ))}
        </div>
      )}

      {lista.comprar.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-t-2 border-tinta pt-3">
          <span>Total estimado, pelo preço médio das compras</span>
          <span className="numeros font-placa text-3xl font-extrabold">
            {lista.total_centavos === null
              ? "falta o preço de algum item"
              : preco(lista.total_centavos)}
          </span>
        </div>
      )}
      {lista.nada_a_comprar.length > 0 && (
        <p className="text-sm text-tinta-suave">
          Nada a comprar: {lista.nada_a_comprar.map((n) => n.toLowerCase()).join(", ")}.
        </p>
      )}
      {lista.comprar.length > 0 && (
        <div className="flex flex-col gap-2">
          <Botao className="self-start" onClick={copiar}>
            Copiar lista para o WhatsApp
          </Botao>
          {copiado && (
            <p role="status" className="text-sm">
              Lista copiada. Cole no WhatsApp do fornecedor.
            </p>
          )}
          {copia && (
            <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="lista-texto">
              Não deu para copiar sozinho. Selecione o texto e copie:
              <textarea
                id="lista-texto"
                readOnly
                value={copia}
                rows={8}
                className="rounded-lg border border-linha bg-superficie p-2 font-normal"
              />
            </label>
          )}
        </div>
      )}

      {lista.pratos.length > 0 && (
        <details className="rounded-xl border border-linha bg-superficie p-4">
          <summary className="cursor-pointer font-semibold">Como o GIRO previu cada prato</summary>
          <p className="my-3 max-w-prose text-sm text-tinta-suave">
            Para cada noite, o valor do meio das últimas 4 noites iguais (entre parênteses). Uma
            noite de feriado não puxa a conta.
          </p>
          <div className="relative overflow-x-auto">
            <table className="numeros w-full text-left text-sm">
              <thead className="text-tinta-suave">
                <tr className="border-b border-linha">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Prato
                  </th>
                  {lista.cobre.map((n) => (
                    <th key={n} scope="col" className="px-3 py-2 font-semibold">
                      {diaDaSemana(n)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.pratos.map((prato) => (
                  <tr key={prato.item_id} className="border-b border-linha last:border-b-0">
                    <th scope="row" className="py-2 pr-4 font-semibold">
                      {prato.nome}
                    </th>
                    {prato.noites.map((n) => (
                      <td key={n.noite} className="whitespace-nowrap px-3 py-2">
                        <b>{n.previstos}</b>{" "}
                        <span className="text-tinta-suave">({n.ultimas.join(", ")})</span>
                        {n.ja_vendidos > 0 && (
                          <span className="block text-xs text-tinta-suave">
                            já saíram {n.ja_vendidos}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function LinhaDaLista({
  linha,
  folga,
  noitesAntes,
}: {
  linha: LinhaDeCompra;
  folga: number;
  noitesAntes: string;
}) {
  const q = (base: number) => quantidade(linha.unidade, base);
  const pedir = textoCompra(
    linha.unidade,
    linha.embalagens,
    linha.embalagem_quantidade,
    linha.embalagem_nome,
  );
  const pratos = linha.pratos
    .slice(0, 3)
    .map((p) => `${p.nome.toLowerCase()}: ${p.pratos} × ${porPorcao(linha.unidade, p.por_porcao)}`);
  const outros = linha.pratos.length - pratos.length;
  return (
    <details className="border-b border-linha py-2" data-testid={`compra-${linha.insumo_id}`}>
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">
          {linha.nome}
          {linha.situacao === "vai_faltar" && (
            <span className="ml-2 text-xs font-bold text-atrasada">vai faltar antes</span>
          )}
        </span>
        <span className="numeros text-right text-sm text-tinta-suave">
          {linha.valor_centavos === null ? "" : preco(linha.valor_centavos)}
        </span>
        <span className="numeros font-placa text-xl font-extrabold">{pedir}</span>
        <span className="text-right text-xs text-ocupada underline underline-offset-2">
          Por que?
        </span>
      </summary>
      <div className="numeros mt-2 flex flex-col gap-0.5 rounded-lg bg-fundo px-3 py-2 text-sm">
        <span>
          Tem agora: <b>{q(linha.tem)}</b>
        </span>
        {linha.sai_ate_compra > 0 && (
          <span>
            Até a compra ainda sai ({noitesAntes}): <b>{q(linha.sai_ate_compra)}</b>. Sobra{" "}
            <b>{q(linha.sobra)}</b>
          </span>
        )}
        <span>
          Nas noites da compra sai: <b>{q(linha.precisa)}</b>
          {pratos.length > 0 &&
            ` (${pratos.join("; ")}${outros > 0 ? `; e mais ${outros} ${outros === 1 ? "prato" : "pratos"}` : ""})`}
        </span>
        <span>
          Com folga de {folga}%: <b>{q(linha.com_folga)}</b>
        </span>
        <span>
          Falta {q(linha.falta)}: <b>{pedir}</b>
        </span>
      </div>
    </details>
  );
}

// ---------- Perdas (só o dono) ----------

function PerdasDoEstoque({
  perdas,
  aoMudarPeriodo,
}: {
  perdas: Perdas;
  aoMudarPeriodo: (periodo: "semana" | "mes") => void;
}) {
  const vendeu = perdas.vendeu_centavos || 1;
  const porMes = perdas.periodo === "semana" ? perdas.escapou_centavos * 4 : null;
  const dicas = perdas.linhas.filter((l) => l.escapou > 0).slice(0, 3);
  // Centavos de diferença só poluem a tabela: entram somados numa linha.
  const relevantes = perdas.linhas.filter(
    (l) => l.valor_escapou_centavos === null || Math.abs(l.valor_escapou_centavos) >= 100,
  );
  const miudos = perdas.linhas.filter((l) => !relevantes.includes(l));
  const somaMiudos = miudos.reduce((s, l) => s + (l.valor_escapou_centavos ?? 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-tinta-suave">
          De {rotuloDia(perdas.primeira_noite)} a {rotuloDia(perdas.ultima_noite)}. A ficha diz
          quanto <b className="text-tinta">deveria</b> sair pelo que foi vendido; a contagem diz
          quanto <b className="text-tinta">saiu</b>. O que a contagem acha a menos vale para os dias
          desde a contagem anterior. Valores pelo preço médio de hoje.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
          {(
            [
              ["semana", "7 dias"],
              ["mes", "4 semanas"],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={perdas.periodo === valor}
              onClick={() => aoMudarPeriodo(valor)}
              className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${
                perdas.periodo === valor
                  ? "border-tinta bg-fundo text-tinta"
                  : "border-linha bg-superficie text-tinta-suave"
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      </header>

      {!perdas.ultima_contagem && (
        <p className="max-w-prose rounded-xl border-l-4 border-aguardando bg-superficie px-4 py-3">
          Ninguém contou o estoque neste período. Sem contagem, só aparece o que foi registrado como
          perda: conte os ingredientes da curva A uma vez por semana.
        </p>
      )}

      <dl className="numeros grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-linha bg-linha md:grid-cols-4">
        <div className="flex flex-col gap-0.5 bg-superficie px-4 py-3">
          <dt className="text-sm font-semibold text-tinta-suave">Vendeu</dt>
          <dd className="font-placa text-3xl font-extrabold">{reais(perdas.vendeu_centavos)}</dd>
          <dd className="text-xs text-tinta-suave">nos pedidos lançados</dd>
        </div>
        <div className="flex flex-col gap-0.5 bg-superficie px-4 py-3">
          <dt className="text-sm font-semibold text-tinta-suave">Custo pela ficha</dt>
          <dd className="font-placa text-3xl font-extrabold">
            {porcento(perdas.custo_pela_ficha_centavos / vendeu)}
          </dd>
          <dd className="text-xs text-tinta-suave">
            {reais(perdas.custo_pela_ficha_centavos)} em ingredientes
          </dd>
        </div>
        <div className="flex flex-col gap-0.5 bg-superficie px-4 py-3">
          <dt className="text-sm font-semibold text-tinta-suave">Custo de verdade</dt>
          <dd className="font-placa text-3xl font-extrabold">
            {porcento(perdas.custo_de_verdade_centavos / vendeu)}
          </dd>
          <dd className="text-xs text-tinta-suave">pelo estoque contado</dd>
        </div>
        <div className="flex flex-col gap-0.5 bg-superficie px-4 py-3">
          <dt className="text-sm font-semibold text-tinta-suave">Escapou</dt>
          <dd className="font-placa text-3xl font-extrabold text-atrasada">
            {reais(perdas.escapou_centavos)}
          </dd>
          <dd className="text-xs text-tinta-suave">
            {porMes !== null ? `uns ${reais(porMes)} por mês` : "nas 4 semanas"}
          </dd>
        </div>
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section aria-labelledby="titulo-diferenca" className="flex min-w-0 flex-col gap-2">
          <h2 id="titulo-diferenca" className="font-placa text-2xl font-bold">
            Onde ficou a diferença
          </h2>
          {perdas.linhas.length === 0 ? (
            <p className="text-tinta-suave">Nada escapou do estoque neste período.</p>
          ) : (
            <div className="relative overflow-x-auto rounded-xl border border-linha bg-superficie">
              <table className="numeros w-full text-left text-sm">
                <thead className="text-tinta-suave">
                  <tr className="border-b border-linha">
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Ingrediente
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">
                      Pela ficha
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">
                      Saiu
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">
                      Escapou
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {relevantes.map((l) => (
                    <tr key={l.insumo_id} className="border-b border-linha last:border-b-0">
                      <th scope="row" className="px-4 py-3 font-semibold">
                        {l.nome}
                      </th>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {quantidade(l.unidade, l.pela_ficha)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {quantidade(l.unidade, l.saiu)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <b>
                          {l.valor_escapou_centavos === null
                            ? quantidade(l.unidade, l.escapou)
                            : preco(l.valor_escapou_centavos)}
                        </b>
                        <span className="block text-xs text-tinta-suave">
                          {quantidade(l.unidade, l.escapou)}
                          {l.registrada > 0 &&
                            `, ${quantidade(l.unidade, l.registrada)} registrada`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {miudos.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-linha text-tinta-suave">
                      <th scope="row" colSpan={3} className="px-4 py-3 font-normal">
                        Outros {miudos.length} ingredientes, menos de R$ 1 cada
                      </th>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {preco(somaMiudos)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          {dicas.length > 0 && (
            <section aria-labelledby="titulo-olhar" className="flex flex-col gap-2">
              <h2 id="titulo-olhar" className="font-placa text-2xl font-bold">
                O que olhar primeiro
              </h2>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                {dicas.map((l) => (
                  <li key={l.insumo_id}>{dicaDaPerda(l)}</li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="titulo-registradas" className="flex flex-col gap-2">
            <h2 id="titulo-registradas" className="font-placa text-2xl font-bold">
              Perdas registradas
            </h2>
            {perdas.por_motivo.length === 0 ? (
              <p className="text-tinta-suave">Ninguém registrou perda neste período.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {perdas.por_motivo.map((m) => (
                  <li key={m.motivo}>
                    <b>{m.motivo}:</b>{" "}
                    {m.itens
                      .map(
                        (i) => `${quantidade(i.unidade, i.quantidade)} de ${i.nome.toLowerCase()}`,
                      )
                      .join(", ")}
                    {m.valor_centavos !== null && (
                      <span className="text-tinta-suave"> ({preco(m.valor_centavos)})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {perdas.precos.length > 0 && (
        <section aria-labelledby="titulo-precos" className="flex flex-col gap-2">
          <h2 id="titulo-precos" className="font-placa text-2xl font-bold">
            O preço subiu
          </h2>
          <ul className="flex flex-col gap-3">
            {perdas.precos.map((p) => {
              const medida = p.unidade === "g" ? "/kg" : p.unidade === "ml" ? "/L" : " a unidade";
              return (
                <li
                  key={p.insumo_id}
                  className="rounded-xl border-l-4 border-aguardando bg-superficie px-4 py-3"
                >
                  <b>{p.nome}</b> subiu {p.pct}%: de {preco(p.antes_centavos)}
                  {medida} para {preco(p.agora_centavos)}
                  {medida}, desde {rotuloDia(noiteDe(Date.parse(p.em)))}.
                  {p.pratos.length > 0 && (
                    <span className="block text-sm text-tinta-suave">
                      Cada prato passou a custar a mais:{" "}
                      {p.pratos
                        .map(
                          (prato) => `${prato.nome.toLowerCase()} ${preco(prato.a_mais_centavos)}`,
                        )
                        .join("; ")}
                      . Vale rever o preço ou a porção.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {perdas.curva_a.length > 0 && (
        <p className="max-w-prose rounded-xl border-l-4 border-ocupada bg-superficie px-4 py-3">
          <b>Curva ABC:</b> {perdas.curva_a.length} ingredientes somam 80% do que sai do estoque:{" "}
          {perdas.curva_a.map((n) => n.toLowerCase()).join(", ")}. São esses que valem uma contagem
          toda semana.
        </p>
      )}
      {perdas.itens_sem_custo.length > 0 && (
        <p className="text-sm text-tinta-suave">
          Sem custo informado, fora da conta: {perdas.itens_sem_custo.join(", ")}.
        </p>
      )}
    </div>
  );
}
