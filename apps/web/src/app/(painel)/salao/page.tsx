"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ListaAlertas } from "@/components/alertas";
import { AvisosDoAparelho } from "@/components/avisos-aparelho";
import { DetalheMesa } from "@/components/detalhe-mesa";
import { LimiteDeErro } from "@/components/limite-de-erro";
import { AmostraTom, MesaNaPlanta } from "@/components/mesa";
import { Aviso } from "@/components/ui";
import { api } from "@/lib/api";
import { type Conexao, useRelogio, useSalaoAoVivo } from "@/lib/ao-vivo";
import { prepararSom, tocarAlerta } from "@/lib/avisos";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { camerasSemSinal, contarPorTom, minutosEntre, type Tom } from "@/lib/salao";
import { podeGerirMesas, useSessao } from "@/lib/sessao";
import type { Alerta, Mesa } from "@/lib/tipos";
import { temWebGL } from "@/lib/webgl";

import type { PedidoDeFoco } from "@/components/salao-3d";

// O 3D (three.js) só é baixado quando alguém abre o salão em 3D.
const Salao3D = dynamic(() => import("@/components/salao-3d"), {
  ssr: false,
  loading: () => <MontandoSalao3D />,
});

const CHAVE_SOM = "giro:som";
const CHAVE_VISTA = "giro:vista";

type Vista = "3d" | "planta";

function lerPreferenciaSom(): boolean {
  try {
    return typeof window === "undefined" || localStorage.getItem(CHAVE_SOM) !== "0";
  } catch {
    return true; // navegador sem armazenamento: fica com o som ligado
  }
}

/** Computador abre em 3D; celular abre na planta, que é mais rápida de ler no meio do serviço. */
function lerVistaInicial(): Vista {
  if (typeof window === "undefined" || !temWebGL()) return "planta";
  try {
    const guardada = localStorage.getItem(CHAVE_VISTA);
    if (guardada === "3d" || guardada === "planta") return guardada;
  } catch {
    // navegador sem armazenamento: escolhe pelo tamanho da tela
  }
  return window.matchMedia("(min-width: 1024px)").matches ? "3d" : "planta";
}

export default function PaginaSalao() {
  const { sessao } = useSessao();
  const restaurante = useRestauranteAlvo();
  const [somLigado, setSomLigado] = useState(lerPreferenciaSom);
  const [vista, setVista] = useState<Vista>(lerVistaInicial);
  const [com3D, setCom3D] = useState(() => typeof window !== "undefined" && temWebGL());
  const som = useRef(somLigado);
  const [mesaAberta, setMesaAberta] = useState<number | null>(null);
  const [foco, setFoco] = useState<PedidoDeFoco | null>(null);
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

  function mudarVista(nova: Vista) {
    setVista(nova);
    try {
      localStorage.setItem(CHAVE_VISTA, nova);
    } catch {
      // sem armazenamento: vale só enquanto a página estiver aberta
    }
  }

  function quandoO3DFalhar() {
    setCom3D(false);
    setVista("planta");
    setRecado({
      tipo: "erro",
      texto: "Este aparelho não conseguiu abrir o salão em 3D. Mostrando a planta.",
    });
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

  const com3DAberto = vista === "3d" && com3D && salao.mesas.length > 0;

  /** Leva a câmera do 3D até a mesa do alerta e traz o 3D para a tela, se estiver longe. */
  function verNoSalao(alerta: Alerta) {
    setFoco({ mesaId: alerta.mesa_id, vez: Date.now() });
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .querySelector('[data-testid="salao-3d"]')
      ?.scrollIntoView({ block: "nearest", behavior: reduzido ? "auto" : "smooth" });
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-placa text-4xl font-extrabold leading-none">Salão</h1>
        <IndicadorConexao conexao={conexao} />
      </div>

      {camerasSemSinal(salao.cameras, agora).map((camera) => (
        <Aviso key={camera.id}>
          A câmera {camera.nome} parou de mandar imagem há{" "}
          {minutosEntre(camera.ultima_observacao_em as string, agora)} min. Enquanto isso, as mesas
          dela ficam sem alerta. Confira a internet do restaurante e se o gravador está ligado.
        </Aviso>
      ))}

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
            aoVerNoSalao={com3DAberto ? verNoSalao : undefined}
          />
        </section>

        <section
          aria-label="Planta do salão"
          className="flex flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Contagem mesas={salao.mesas} agoraMs={agora} limiteSeg={limite} />
            {com3D && salao.mesas.length > 0 && <SeletorVista vista={vista} aoMudar={mudarVista} />}
          </div>
          {salao.mesas.length === 0 ? (
            <SalaoVazio podeCadastrar={!!sessao && podeGerirMesas(sessao.usuario.papel)} />
          ) : vista === "3d" && com3D ? (
            <LimiteDeErro reserva={null} aoFalhar={quandoO3DFalhar}>
              <Salao3D
                mesas={salao.mesas}
                alertas={salao.alertas}
                foco={foco}
                agoraMs={agora}
                limiteSeg={limite}
                nome={salao.restaurante.nome}
                aoAbrir={setMesaAberta}
              />
            </LimiteDeErro>
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

function SeletorVista({ vista, aoMudar }: { vista: Vista; aoMudar: (vista: Vista) => void }) {
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

function MontandoSalao3D() {
  return (
    <div className="grid h-[min(68vh,660px)] min-h-[380px] place-items-center rounded-2xl border border-linha bg-superficie text-tinta-suave">
      Montando o salão em 3D...
    </div>
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
