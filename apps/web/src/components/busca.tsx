"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { api } from "@/lib/api";
import { buscar, comRestauranteNoLink, type Fontes, type TipoResultado } from "@/lib/busca";
import type { Cardapio, Estoque, Papel, Salao } from "@/lib/tipos";

const ROTULO: Record<TipoResultado, string> = {
  mesa: "Mesa",
  prato: "Prato",
  ingrediente: "Ingrediente",
  tela: "Tela",
};

const VAZIO: Fontes = { mesas: [], cardapio: null, insumos: [] };

/** Quem está digitando num campo não quer que a barra "/" abra a busca. */
function digitando(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  return alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName);
}

/** O botão "Buscar" do menu e a janela da busca. Abre também com "/" ou Ctrl+K. */
export function Busca({ papel, restaurante }: { papel: Papel; restaurante: number | null }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const caminho = usePathname();
  const idLista = useId();
  const [termo, setTermo] = useState("");
  const [fontes, setFontes] = useState<Fontes>(VAZIO);
  const [ativo, setAtivo] = useState(0);
  const sufixo = papel === "admin_giro" && restaurante ? String(restaurante) : null;

  const resultados = buscar(termo, fontes, papel);

  function abrir() {
    if (!restaurante || dialogo.current?.open) return;
    setTermo("");
    setAtivo(0);
    dialogo.current?.showModal();
    campo.current?.focus();
    // Busca de novo a cada vez: o salão e o estoque mudam durante a noite. Se uma parte
    // falhar (sem internet), as outras continuam servindo, e as telas sempre aparecem.
    void Promise.allSettled([
      api<Salao>("/api/salao", { restaurante }),
      api<Cardapio>("/api/cardapio", { restaurante }),
      api<Estoque>("/api/estoque", { restaurante }),
    ]).then(([salao, cardapio, estoque]) =>
      setFontes({
        mesas: salao.status === "fulfilled" ? salao.value.mesas.filter((m) => m.ativa) : [],
        cardapio: cardapio.status === "fulfilled" ? cardapio.value : null,
        insumos: estoque.status === "fulfilled" ? estoque.value.insumos : [],
      }),
    );
  }

  function fechar() {
    dialogo.current?.close();
  }

  function ir(href: string) {
    fechar();
    router.push(comRestauranteNoLink(href, sufixo));
  }

  // "/" ou Ctrl+K de qualquer tela.
  const tecla = useEffectEvent((evento: KeyboardEvent) => {
    const atalho =
      (evento.key === "/" && !digitando(evento.target)) ||
      (evento.key.toLowerCase() === "k" && (evento.ctrlKey || evento.metaKey));
    if (!atalho || evento.altKey) return;
    evento.preventDefault();
    abrir();
  });
  useEffect(() => {
    const ouvir = (evento: KeyboardEvent) => tecla(evento);
    window.addEventListener("keydown", ouvir);
    return () => window.removeEventListener("keydown", ouvir);
  }, []);

  // Mudou de tela: a janela fecha (o Next guarda a tela anterior escondida, e uma janela
  // aberta por baixo travaria os toques na nova).
  useEffect(() => {
    if (caminho) dialogo.current?.close();
  }, [caminho]);

  useEffect(() => {
    const atual = dialogo.current;
    return () => atual?.close();
  }, []);

  if (!restaurante) return null;

  const idAtivo = resultados[ativo] ? `${idLista}-${ativo}` : undefined;

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="flex items-center gap-2 rounded-lg border border-linha px-3 py-2 font-semibold text-tinta-suave hover:text-tinta"
        aria-keyshortcuts="/ Control+K"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="2" />
          <path d="m13 13 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Buscar
        <kbd className="hidden rounded border border-linha px-1.5 text-xs font-normal lg:inline">
          /
        </kbd>
      </button>
      <dialog
        ref={dialogo}
        aria-label="Buscar"
        className="mx-auto mt-[10vh] w-[min(34rem,calc(100vw-2rem))] rounded-2xl bg-superficie p-0 text-tinta shadow-xl"
        onClick={(evento) => {
          if (evento.target === dialogo.current) fechar(); // toque fora da caixa
        }}
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-linha px-4">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="size-5 text-tinta-suave"
              fill="none"
            >
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="2" />
              <path d="m13 13 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              ref={campo}
              type="search"
              role="combobox"
              aria-label="O que você procura?"
              aria-expanded={resultados.length > 0}
              aria-controls={idLista}
              aria-activedescendant={idAtivo}
              aria-autocomplete="list"
              placeholder="Mesa 7, lasanha, muçarela, ajustes..."
              autoComplete="off"
              className="min-h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-tinta-suave"
              value={termo}
              onChange={(evento) => {
                setTermo(evento.target.value);
                setAtivo(0);
              }}
              onKeyDown={(evento) => {
                if (evento.key === "ArrowDown") {
                  evento.preventDefault();
                  setAtivo((i) => Math.min(i + 1, resultados.length - 1));
                } else if (evento.key === "ArrowUp") {
                  evento.preventDefault();
                  setAtivo((i) => Math.max(i - 1, 0));
                } else if (evento.key === "Enter" && resultados[ativo]) {
                  evento.preventDefault();
                  ir(resultados[ativo].href);
                }
              }}
            />
            <button
              type="button"
              onClick={fechar}
              className="rounded-lg px-2 py-2 font-semibold text-tinta-suave hover:text-tinta"
            >
              Fechar
            </button>
          </div>
          <ul id={idLista} role="listbox" aria-label="Resultados" className="flex flex-col p-2">
            {resultados.map((r, i) => (
              <li
                key={`${r.tipo}-${r.href}-${r.titulo}`}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === ativo}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 ${
                  i === ativo ? "bg-fundo" : ""
                }`}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => ir(r.href)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{r.titulo}</span>
                  <span className="truncate text-sm text-tinta-suave">{r.detalhe}</span>
                </span>
                <span className="shrink-0 rounded-md border border-linha px-2 py-0.5 text-xs text-tinta-suave">
                  {ROTULO[r.tipo]}
                </span>
              </li>
            ))}
          </ul>
          {termo.trim() && resultados.length === 0 && (
            <p className="px-5 pb-5 text-tinta-suave">
              Nada com “{termo.trim()}”. Tente o número da mesa, o nome do prato ou da tela.
            </p>
          )}
          {!termo.trim() && (
            <p className="px-5 pb-5 text-sm text-tinta-suave">
              Digite o número da mesa, um prato, um ingrediente ou o nome de uma tela. Setas para
              escolher, Enter para abrir.
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
