// Peças do salão usadas no ao vivo e no replay da noite: a planta, a contagem (que também é a
// legenda das cores) e a troca entre 3D e planta.

import { AmostraTom } from "@/components/mesa";
import { contarPorTom, type Tom } from "@/lib/salao";
import type { Mesa } from "@/lib/tipos";
import { temWebGL } from "@/lib/webgl";

export type Vista = "3d" | "planta";

const CHAVE_VISTA = "giro:vista";

/** Computador abre em 3D; celular abre na planta, que é mais rápida de ler no meio do serviço. */
export function lerVistaInicial(): Vista {
  if (typeof window === "undefined" || !temWebGL()) return "planta";
  try {
    const guardada = localStorage.getItem(CHAVE_VISTA);
    if (guardada === "3d" || guardada === "planta") return guardada;
  } catch {
    // navegador sem armazenamento: escolhe pelo tamanho da tela
  }
  return window.matchMedia("(min-width: 1024px)").matches ? "3d" : "planta";
}

/** Lembra a vista escolhida neste aparelho (vale para o salão ao vivo e para o replay). */
export function guardarVista(vista: Vista) {
  try {
    localStorage.setItem(CHAVE_VISTA, vista);
  } catch {
    // sem armazenamento: vale só enquanto a página estiver aberta
  }
}

export function Planta({ mesas, children }: { mesas: Mesa[]; children: React.ReactNode }) {
  const colunas = Math.max(...mesas.map((m) => m.pos_x)) + 1;
  return (
    // O piso do salão: a área onde as mesas ficam, rolando de lado se não couber no celular.
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:rounded-2xl sm:border sm:border-linha sm:bg-superficie sm:p-5">
      <div
        className="grid gap-x-3 gap-y-2"
        style={{ gridTemplateColumns: `repeat(${colunas}, minmax(76px, 136px))` }}
      >
        {children}
      </div>
    </div>
  );
}

// Mesmas palavras que aparecem dentro das mesas, para a contagem servir de legenda.
const NOMES: Record<Tom, [string, string]> = {
  livre: ["livre", "livres"],
  aguardando: ["esperando", "esperando"],
  atrasada: ["atrasada", "atrasadas"],
  ocupada: ["ocupada", "ocupadas"],
  limpar: ["para limpar", "para limpar"],
};

/** Quantas mesas em cada estado. Também é a legenda das cores. */
export function Contagem({
  mesas,
  agoraMs,
  limiteSeg,
}: {
  mesas: Mesa[];
  agoraMs: number;
  limiteSeg: number;
}) {
  const contagem = contarPorTom(mesas, agoraMs, limiteSeg);
  const ordem: Tom[] = ["atrasada", "aguardando", "limpar", "ocupada", "livre"];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Resumo do salão">
      {ordem.map((tom) => (
        <li
          key={tom}
          className={`flex items-center gap-1.5 ${contagem[tom] === 0 ? "text-tinta-suave" : "font-semibold"}`}
        >
          <AmostraTom tom={tom} />
          <span className="numeros">{contagem[tom]}</span>
          {NOMES[tom][contagem[tom] === 1 ? 0 : 1]}
        </li>
      ))}
    </ul>
  );
}

export function SeletorVista({
  vista,
  aoMudar,
}: {
  vista: Vista;
  aoMudar: (vista: Vista) => void;
}) {
  const opcoes: [Vista, string][] = [
    ["3d", "Salão 3D"],
    ["planta", "Planta"],
  ];
  return (
    <div
      role="group"
      aria-label="Como ver o salão"
      className="inline-flex rounded-lg border border-linha bg-superficie p-0.5"
    >
      {opcoes.map(([valor, rotulo]) => (
        <button
          key={valor}
          type="button"
          aria-pressed={vista === valor}
          onClick={() => aoMudar(valor)}
          className={`min-h-9 rounded-md px-3 text-sm font-semibold ${
            vista === valor ? "bg-tinta text-fundo" : "text-tinta-suave hover:text-tinta"
          }`}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}
