"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ListaAlertas } from "@/components/alertas";
import { AvisosDoAparelho } from "@/components/avisos-aparelho";
import { DetalheMesa } from "@/components/detalhe-mesa";
import { AmostraTom, MesaNaPlanta } from "@/components/mesa";
import { Aviso } from "@/components/ui";
import { api } from "@/lib/api";
import { type Conexao, useRelogio, useSalaoAoVivo } from "@/lib/ao-vivo";
import { prepararSom, tocarAlerta } from "@/lib/avisos";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { contarPorTom, type Tom } from "@/lib/salao";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import type { Alerta, Mesa } from "@/lib/tipos";

const CHAVE_SOM = "giro:som";

function lerPreferenciaSom(): boolean {
  try {
    return typeof window === "undefined" || localStorage.getItem(CHAVE_SOM) !== "0";
  } catch {
    return true; // navegador sem armazenamento: fica com o som ligado
  }
}

export default function PaginaSalao() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const [somLigado, setSomLigado] = useState(lerPreferenciaSom);
  const som = useRef(somLigado);
  const [mesaAberta, setMesaAberta] = useState<number | null>(null);
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);

  useEffect(() => {
    // O navegador só libera som depois do primeiro toque na tela.
    const liberar = () => prepararSom();
    window.addEventListener("pointerdown", liberar, { once: true });
    return () => window.removeEventListener("pointerdown", liberar);
  }, []);

  useEffect(() => {
    som.current = somLigado;
  }, [somLigado]);

  const aoChegarAlerta = useCallback(() => {
    if (som.current) tocarAlerta();
  }, []);

  const { estado, conexao } = useSalaoAoVivo(restaurante, aoChegarAlerta);
  const agora = useRelogio(estado.ajusteRelogioMs);
  const salao = estado.salao;

  if (!restaurante) {
    return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;
  }
  if (conexao === "sem_acesso") {
    return <Aviso>Sua sessão expirou ou você não tem acesso a este salão. Entre de novo.</Aviso>;
  }
  if (!salao) {
    return <p className="text-tinta-suave">Abrindo o salão...</p>;
  }

  const limite = salao.restaurante.alerta_atendimento_seg;
  const mesa = salao.mesas.find((m) => m.id === mesaAberta) ?? null;

  async function liberar(alvo: { id: number; numero: number }) {
    try {
      await api(`/api/mesas/${alvo.id}/liberar`, { metodo: "POST" });
      setMesaAberta(null);
      setRecado({ tipo: "ok", texto: `Mesa ${alvo.numero} liberada.` });
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  function mudarSom(ligado: boolean) {
    setSomLigado(ligado);
    try {
      localStorage.setItem(CHAVE_SOM, ligado ? "1" : "0");
    } catch {
      // sem armazenamento: vale só enquanto a página estiver aberta
    }
  }

  async function reconhecer(alerta: Alerta) {
    try {
      await api(`/api/alertas/${alerta.id}/reconhecer`, { metodo: "POST" });
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-placa text-4xl font-extrabold leading-none">Salão</h1>
        <IndicadorConexao conexao={conexao} />
      </div>

      {recado && (
        <Aviso tipo={recado.tipo}>
          <span className="flex items-center justify-between gap-3">
            {recado.texto}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => setRecado(null)}
            >
              Ok
            </button>
          </span>
        </Aviso>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <section
          aria-labelledby="titulo-alertas"
          className="flex flex-col gap-3 lg:col-start-2 lg:row-start-1"
        >
          <h2 id="titulo-alertas" className="font-placa text-2xl font-bold">
            Precisa de atenção
          </h2>
          <ListaAlertas
            alertas={salao.alertas}
            agoraMs={agora}
            aoReconhecer={reconhecer}
            aoLiberar={(a) => liberar({ id: a.mesa_id, numero: a.mesa_numero })}
          />
        </section>

        <section
          aria-label="Planta do salão"
          className="flex flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1"
        >
          <Contagem mesas={salao.mesas} agoraMs={agora} limiteSeg={limite} />
          {salao.mesas.length === 0 ? (
            <SalaoVazio podeCadastrar={!!sessao && podeGerirMesas(sessao.usuario.papel)} />
          ) : (
            <Planta mesas={salao.mesas}>
              {salao.mesas.map((m) => (
                <MesaNaPlanta
                  key={m.id}
                  mesa={m}
                  agoraMs={agora}
                  limiteSeg={limite}
                  aoAbrir={(alvo) => setMesaAberta(alvo.id)}
                />
              ))}
            </Planta>
          )}
        </section>

        <div className="lg:col-start-2 lg:row-start-2">
          <AvisosDoAparelho
            somLigado={somLigado}
            aoMudarSom={mudarSom}
            podeReceberPush={sessao?.usuario.restaurante_id != null}
          />
        </div>
      </div>

      <DetalheMesa
        mesa={mesa}
        agoraMs={agora}
        limiteSeg={limite}
        aoFechar={() => setMesaAberta(null)}
        aoLiberar={liberar}
      />
    </>
  );
}

function Planta({ mesas, children }: { mesas: Mesa[]; children: React.ReactNode }) {
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
function Contagem({
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

function IndicadorConexao({ conexao }: { conexao: Conexao }) {
  const aoVivo = conexao === "ao_vivo";
  return (
    <span className="flex items-center gap-2 text-sm font-semibold" role="status">
      <span
        aria-hidden
        className={`size-2.5 rounded-full ${aoVivo ? "bg-ocupada" : "bg-aguardando"}`}
      />
      {aoVivo ? "Ao vivo" : "Reconectando..."}
    </span>
  );
}

function SalaoVazio({ podeCadastrar }: { podeCadastrar: boolean }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-linha p-6">
      <p className="font-semibold">Nenhuma mesa cadastrada ainda.</p>
      {podeCadastrar ? (
        <p className="text-tinta-suave">
          <Link href="/mesas" className="font-semibold text-tinta underline">
            Cadastre as mesas do salão
          </Link>{" "}
          para o mapa aparecer aqui.
        </p>
      ) : (
        <p className="text-tinta-suave">Peça ao gerente para cadastrar as mesas.</p>
      )}
    </div>
  );
}
