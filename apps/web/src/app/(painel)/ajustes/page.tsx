"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Aviso, Botao, Campo, Secao } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { horaCurta } from "@/lib/salao";
import type { Camera, Restaurante, Salao } from "@/lib/tipos";

export default function PaginaAjustes() {
  const restaurante = useRestauranteAlvo();
  const [tokenNovo, setTokenNovo] = useState<{ nome: string; token: string } | null>(null);
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const buscar = useCallback(async () => {
    const [salao, cameras] = await Promise.all([
      api<Salao>("/api/salao", { restaurante }),
      api<Camera[]>("/api/cameras", { restaurante }),
    ]);
    return { restaurante: salao.restaurante, cameras };
  }, [restaurante]);
  const { dados: carregado, erro, recarregar } = useDados(restaurante ? buscar : null);
  const dados = carregado?.restaurante ?? null;
  const cameras = carregado?.cameras ?? [];

  async function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!dados) return;
    const form = new FormData(evento.currentTarget);
    try {
      await api<Restaurante>(`/api/restaurantes/${dados.id}`, {
        metodo: "PATCH",
        corpo: {
          nome: form.get("nome"),
          cidade: form.get("cidade") || null,
          alerta_atendimento_seg: Math.round(Number(form.get("alerta_min")) * 60),
          ticket_medio_centavos: Math.round(Number(form.get("ticket")) * 100),
          abre_as: form.get("abre_as"),
          fecha_as: form.get("fecha_as"),
        },
      });
      setRecado({ tipo: "ok", texto: "Ajustes salvos. O painel já usa os novos valores." });
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  async function criarCamera(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const nome = String(new FormData(formulario).get("nome"));
    try {
      const criada = await api<Camera & { token: string }>("/api/cameras", {
        metodo: "POST",
        restaurante,
        corpo: { nome },
      });
      setTokenNovo({ nome: criada.nome, token: criada.token });
      formulario.reset();
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;

  return (
    <>
      <h1 className="font-placa text-4xl font-extrabold leading-none">Ajustes</h1>
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      <Aviso>{erro}</Aviso>

      <Secao titulo="Restaurante">
        {dados ? (
          <form
            onSubmit={salvar}
            className="grid gap-3 sm:grid-cols-3 sm:items-start"
            key={dados.id}
          >
            <Campo rotulo="Nome" name="nome" defaultValue={dados.nome} required minLength={2} />
            <Campo rotulo="Cidade" name="cidade" defaultValue={dados.cidade ?? ""} />
            <Campo
              rotulo="Avisar cliente sem atendimento depois de (minutos)"
              name="alerta_min"
              type="number"
              min={1}
              max={30}
              step={0.5}
              defaultValue={dados.alerta_atendimento_seg / 60}
              required
            />
            <Campo
              rotulo="Quanto cada pessoa gasta, em média (R$)"
              name="ticket"
              type="number"
              min={5}
              max={1000}
              step={1}
              defaultValue={dados.ticket_medio_centavos / 100}
              ajuda="Usado para mostrar o dinheiro que ficou na mesa em Resultados."
              required
            />
            <Campo
              rotulo="O salão abre às"
              name="abre_as"
              type="time"
              defaultValue={dados.abre_as}
              ajuda="Na abertura, o GIRO manda o recado do dia."
              required
            />
            <Campo
              rotulo="E fecha às"
              name="fecha_as"
              type="time"
              defaultValue={dados.fecha_as}
              ajuda="No fechamento, chega o resumo da noite."
              required
            />
            <Botao type="submit" className="sm:col-span-3 sm:justify-self-start">
              Salvar ajustes
            </Botao>
          </form>
        ) : (
          <p className="text-tinta-suave">Carregando...</p>
        )}
      </Secao>

      <Secao
        titulo="Câmeras"
        descricao="Cada câmera recebe uma chave de acesso, usada pelo gravador do restaurante (ou pelo simulador) para mandar o que vê. A chave aparece uma vez só."
      >
        {tokenNovo && (
          <div
            className="flex flex-col gap-2 rounded-xl border-l-[6px] border-ocupada bg-superficie p-4"
            role="status"
          >
            <p className="font-semibold">Chave da câmera {tokenNovo.nome}</p>
            <code className="break-all rounded bg-fundo px-2 py-1">{tokenNovo.token}</code>
            <p className="text-sm text-tinta-suave">
              Copie agora e guarde num lugar seguro. Depois que sair desta tela, ela não aparece de
              novo.
            </p>
          </div>
        )}
        <ul className="flex flex-col divide-y divide-linha">
          {cameras.map((camera) => (
            <li key={camera.id} className="flex items-center justify-between gap-3 py-3">
              <Link
                href={`/cameras?camera=${camera.id}`}
                className="font-semibold underline decoration-linha underline-offset-4"
              >
                {camera.nome}
              </Link>
              <span className="text-sm text-tinta-suave">
                {camera.ultima_observacao_em
                  ? `Última imagem analisada às ${horaCurta(camera.ultima_observacao_em)}`
                  : "Ainda não mandou nada"}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={criarCamera} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Campo
              rotulo="Nome da câmera"
              name="nome"
              placeholder="Ex.: Salão principal"
              required
              minLength={2}
            />
          </div>
          <Botao type="submit" variante="secundario">
            Adicionar câmera
          </Botao>
        </form>
      </Secao>
    </>
  );
}
