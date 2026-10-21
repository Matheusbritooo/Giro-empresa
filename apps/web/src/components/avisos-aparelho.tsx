"use client";

import { useEffect, useState } from "react";

import {
  ativarPush,
  chavePublicaPush,
  desativarPush,
  inscricaoAtual,
  prepararSom,
  pushSuportado,
  tocarAlerta,
} from "@/lib/avisos";

import { Aviso, Botao } from "./ui";

/** Como este aparelho avisa: som com o painel aberto e notificação com o painel fechado. */
export function AvisosDoAparelho({
  somLigado,
  aoMudarSom,
  podeReceberPush,
}: {
  somLigado: boolean;
  aoMudarSom: (ligado: boolean) => void;
  podeReceberPush: boolean;
}) {
  const [chave, setChave] = useState<string | null>(null);
  const [inscrito, setInscrito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!podeReceberPush || !pushSuportado()) return;
    chavePublicaPush()
      .then(setChave)
      .catch(() => setChave(null));
    inscricaoAtual()
      .then((i) => setInscrito(!!i))
      .catch(() => setInscrito(false));
  }, [podeReceberPush]);

  async function alternarPush() {
    setOcupado(true);
    setErro(null);
    try {
      if (inscrito) {
        await desativarPush();
        setInscrito(false);
      } else if (chave) {
        await ativarPush(chave);
        setInscrito(true);
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section
      aria-labelledby="titulo-aparelho"
      className="flex flex-col gap-3 border-t border-linha pt-4"
    >
      <h2 id="titulo-aparelho" className="font-semibold">
        Avisos neste aparelho
      </h2>
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span>Tocar som quando surgir um alerta</span>
        <input
          type="checkbox"
          className="size-5 accent-[var(--ocupada)]"
          checked={somLigado}
          onChange={(e) => {
            aoMudarSom(e.target.checked);
            if (e.target.checked) {
              prepararSom();
              tocarAlerta();
            }
          }}
        />
      </label>
      {chave && (
        <Botao variante="secundario" onClick={alternarPush} disabled={ocupado}>
          {inscrito ? "Parar avisos no celular" : "Avisar no celular com o painel fechado"}
        </Botao>
      )}
      <Aviso>{erro}</Aviso>
    </section>
  );
}
