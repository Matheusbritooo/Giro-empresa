"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Aviso, Botao, Campo, Secao } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { useSessao } from "@/lib/sessao";
import type { Restaurante } from "@/lib/tipos";

/** Área da equipe GIRO: clientes ativos e ativação de cliente novo. */
export default function PaginaRestaurantes() {
  const { sessao } = useSessao();
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const souAdmin = sessao?.usuario.papel === "admin_giro";
  const buscar = useCallback(() => api<Restaurante[]>("/api/restaurantes"), []);
  const { dados: lista, erro, recarregar } = useDados(souAdmin ? buscar : null);

  async function ativar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const f = new FormData(formulario);
    try {
      const novo = await api<Restaurante>("/api/restaurantes", {
        metodo: "POST",
        corpo: {
          nome: f.get("nome"),
          cidade: f.get("cidade") || null,
          dono: {
            nome: f.get("dono_nome"),
            email: f.get("dono_email"),
            senha: f.get("dono_senha"),
          },
        },
      });
      setRecado({ tipo: "ok", texto: `${novo.nome} ativado. O dono já pode entrar.` });
      formulario.reset();
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  if (sessao && !souAdmin) {
    return <Aviso>Esta área é só da equipe GIRO.</Aviso>;
  }

  return (
    <>
      <h1 className="font-placa text-4xl font-extrabold leading-none">Restaurantes</h1>
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      <Aviso>{erro}</Aviso>

      <Secao titulo="Clientes">
        {lista === null ? (
          <p className="text-tinta-suave">Carregando...</p>
        ) : lista.length === 0 ? (
          <p className="text-tinta-suave">Nenhum restaurante ainda. Ative o primeiro abaixo.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-linha">
            {lista.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-semibold">{r.nome}</span>
                  {r.cidade && <span className="text-tinta-suave">, {r.cidade}</span>}
                </span>
                <span className="flex gap-2">
                  <Link
                    href={`/salao?restaurante=${r.id}`}
                    className="rounded-lg bg-tinta px-4 py-2.5 font-semibold text-fundo"
                  >
                    Abrir salão
                  </Link>
                  <Link
                    href={`/mesas?restaurante=${r.id}`}
                    className="rounded-lg border border-linha px-4 py-2.5 font-semibold"
                  >
                    Mesas
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao
        titulo="Ativar cliente novo"
        descricao="Cria o restaurante e o acesso do dono. Depois cadastre as mesas e a câmera na visita de ativação."
      >
        <form onSubmit={ativar} className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome do restaurante" name="nome" required minLength={2} />
          <Campo rotulo="Cidade" name="cidade" />
          <Campo rotulo="Nome do dono" name="dono_nome" required minLength={2} />
          <Campo rotulo="E-mail do dono" name="dono_email" type="email" required />
          <Campo
            rotulo="Senha inicial do dono"
            name="dono_senha"
            type="password"
            required
            minLength={8}
          />
          <Botao type="submit" className="sm:col-span-2 sm:justify-self-start">
            Ativar restaurante
          </Botao>
        </form>
      </Secao>
    </>
  );
}
