"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { podeGerirEquipe, podeGerirMesas, useSessao } from "@/lib/sessao";
import type { Sessao } from "@/lib/tipos";

import { Marca } from "./marca";

export function Cabecalho({
  sessao,
  restaurante,
  nomeRestaurante,
}: {
  sessao: Sessao;
  restaurante: number | null;
  nomeRestaurante: string | null;
}) {
  const caminho = usePathname();
  const router = useRouter();
  const { sair } = useSessao();
  const papel = sessao.usuario.papel;
  const sufixo = papel === "admin_giro" && restaurante ? `?restaurante=${restaurante}` : "";

  const links = [
    papel === "admin_giro" && { href: "/restaurantes", texto: "Restaurantes", sufixo: "" },
    restaurante && { href: "/salao", texto: "Salão", sufixo },
    restaurante && podeGerirMesas(papel) && { href: "/mesas", texto: "Mesas", sufixo },
    restaurante && podeGerirMesas(papel) && { href: "/cameras", texto: "Câmeras", sufixo },
    restaurante && podeGerirEquipe(papel) && { href: "/equipe", texto: "Equipe", sufixo },
    restaurante && podeGerirEquipe(papel) && { href: "/ajustes", texto: "Ajustes", sufixo },
  ].filter(Boolean) as { href: string; texto: string; sufixo: string }[];

  return (
    <header className="border-b border-linha bg-superficie">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <Marca tamanho={26} />
          {nomeRestaurante && (
            <span className="font-semibold text-tinta-suave">{nomeRestaurante}</span>
          )}
        </div>
        <nav
          aria-label="Seções"
          className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto"
        >
          {links.map((link) => {
            const ativo = caminho === link.href;
            return (
              <Link
                key={link.href}
                href={link.href + link.sufixo}
                aria-current={ativo ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-2 font-semibold ${
                  ativo ? "bg-tinta text-fundo" : "text-tinta-suave hover:text-tinta"
                }`}
              >
                {link.texto}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-tinta-suave sm:inline">{sessao.usuario.nome}</span>
          <button
            type="button"
            className="rounded-lg px-2 py-2 font-semibold text-tinta-suave hover:text-tinta"
            onClick={async () => {
              await sair();
              router.replace("/entrar");
            }}
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
