"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { DesenhoDeMesas } from "@/components/desenho-mesas";
import { Aviso, Botao, Campo, Secao } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { horaCurta } from "@/lib/salao";
import { podeGerirEquipe, useSessao } from "@/lib/sessao";
import type { Camera, Mesa } from "@/lib/tipos";

export default function PaginaCameras() {
  const restaurante = useRestauranteAlvo();
  const { sessao } = useSessao();
  const parametros = useSearchParams();

  const buscarCameras = useCallback(
    () => api<Camera[]>("/api/cameras", { restaurante }),
    [restaurante],
  );
  const cameras = useDados(restaurante ? buscarCameras : null);
  const buscarMesas = useCallback(() => api<Mesa[]>("/api/mesas", { restaurante }), [restaurante]);
  const mesas = useDados(restaurante ? buscarMesas : null);

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;

  const lista = cameras.dados ?? [];
  const pedida = Number(parametros.get("camera"));
  const camera = lista.find((c) => c.id === pedida) ?? lista[0] ?? null;
  const ajusta = !!sessao && podeGerirEquipe(sessao.usuario.papel);

  function endereco(cameraId: number) {
    const busca = new URLSearchParams({ camera: String(cameraId) });
    if (sessao?.usuario.papel === "admin_giro") busca.set("restaurante", String(restaurante));
    return `/cameras?${busca}`;
  }

  return (
    <>
      <h1 className="font-placa text-4xl font-extrabold leading-none">Câmeras</h1>
      <Aviso>{cameras.erro ?? mesas.erro}</Aviso>

      {cameras.dados !== null && lista.length === 0 && (
        <p className="text-tinta-suave">
          Nenhuma câmera cadastrada.{" "}
          {ajusta ? (
            <Link href="/ajustes" className="font-semibold text-tinta underline">
              Cadastre a primeira em Ajustes
            </Link>
          ) : (
            "Peça ao dono para cadastrar em Ajustes."
          )}
        </p>
      )}

      {lista.length > 1 && (
        <nav aria-label="Escolher câmera" className="flex flex-wrap gap-2">
          {lista.map((c) => (
            <Link
              key={c.id}
              href={endereco(c.id)}
              aria-current={c.id === camera?.id ? "page" : undefined}
              className={`rounded-lg px-3 py-2 font-semibold ${
                c.id === camera?.id ? "bg-tinta text-fundo" : "border border-linha"
              }`}
            >
              {c.nome}
            </Link>
          ))}
        </nav>
      )}

      {camera && (
        <>
          <p className="text-tinta-suave">
            {camera.nome}:{" "}
            {camera.ultima_observacao_em
              ? `última imagem analisada às ${horaCurta(camera.ultima_observacao_em)}`
              : "ainda não mandou imagem"}
            {!camera.ativa && ". Câmera desligada em Ajustes."}
          </p>
          <DesenhoDeMesas
            key={camera.id}
            camera={camera}
            mesas={mesas.dados ?? []}
            aoMudarMesas={mesas.recarregar}
          />
          {ajusta && (
            <Calibracao key={`c${camera.id}`} camera={camera} aoSalvar={cameras.recarregar} />
          )}
        </>
      )}
    </>
  );
}

/** Ajuste fino da regra de sentado e em pé, feito olhando a contagem na foto. */
function Calibracao({ camera, aoSalvar }: { camera: Camera; aoSalvar: () => void }) {
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const atual = camera.ajustes_visao ?? {};

  async function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const numero = (campo: string, escala = 1) => {
      const valor = String(f.get(campo) ?? "").trim();
      return valor === "" ? null : Number(valor.replace(",", ".")) / escala;
    };
    try {
      await api(`/api/cameras/${camera.id}`, {
        metodo: "PATCH",
        corpo: {
          ajustes_visao: {
            proporcao_em_pe: numero("proporcao_em_pe"),
            margem_atendimento: numero("margem_atendimento", 100),
            confianca_minima: numero("confianca_minima", 100),
          },
        },
      });
      setRecado({ tipo: "ok", texto: "Calibração salva. Vale a partir das próximas fotos." });
      aoSalvar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  const porcento = (v: number | undefined) => (v === undefined ? "" : String(Math.round(v * 100)));

  return (
    <Secao
      titulo="Calibração"
      descricao="Mexa aqui olhando a contagem na foto acima. Campo vazio volta ao padrão."
    >
      <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-3 sm:items-start">
        <Campo
          rotulo="Pessoa em pé quando a altura passa de (vezes a largura)"
          name="proporcao_em_pe"
          inputMode="decimal"
          placeholder="padrão 2,2"
          defaultValue={atual.proporcao_em_pe ?? ""}
          ajuda="Garçom contado como sentado? Diminua. Cliente contado em pé? Aumente."
        />
        <Campo
          rotulo="Distância em volta da mesa onde o garçom conta (% da foto)"
          name="margem_atendimento"
          inputMode="numeric"
          placeholder="padrão 5"
          defaultValue={porcento(atual.margem_atendimento)}
        />
        <Campo
          rotulo="Certeza mínima para contar uma pessoa (%)"
          name="confianca_minima"
          inputMode="numeric"
          placeholder="padrão 35"
          defaultValue={porcento(atual.confianca_minima)}
          ajuda="Contando sombra ou cadeira como pessoa? Aumente."
        />
        <Botao type="submit" className="sm:col-span-3 sm:justify-self-start">
          Salvar calibração
        </Botao>
      </form>
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
    </Secao>
  );
}
