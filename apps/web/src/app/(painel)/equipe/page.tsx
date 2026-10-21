"use client";

import { useCallback, useState } from "react";

import { Aviso, Botao, Campo, PAPEIS, Secao, Selecao } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { useRestauranteAlvo } from "@/lib/restaurante";
import { useSessao } from "@/lib/sessao";
import type { Usuario } from "@/lib/tipos";

export default function PaginaEquipe() {
  const restaurante = useRestauranteAlvo();
  const { sessao } = useSessao();
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const souAdmin = sessao?.usuario.papel === "admin_giro";
  const buscar = useCallback(() => api<Usuario[]>("/api/usuarios", { restaurante }), [restaurante]);
  const { dados: usuarios, erro, recarregar } = useDados(restaurante ? buscar : null);

  async function criar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const dados = Object.fromEntries(new FormData(formulario));
    try {
      const novo = await api<Usuario>("/api/usuarios", {
        metodo: "POST",
        restaurante,
        corpo: dados,
      });
      setRecado({
        tipo: "ok",
        texto: `${novo.nome} já pode entrar com o e-mail ${novo.email} e a senha que você definiu.`,
      });
      formulario.reset();
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  async function alternar(usuario: Usuario) {
    try {
      await api(`/api/usuarios/${usuario.id}`, {
        metodo: "PATCH",
        corpo: { ativo: !usuario.ativo },
      });
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;

  return (
    <>
      <h1 className="font-placa text-4xl font-extrabold leading-none">Equipe</h1>
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      <Aviso>{erro}</Aviso>

      <Secao
        titulo="Dar acesso a alguém"
        descricao="Gerente recebe o alerta de cliente sem atendimento e cadastra mesas. Equipe do salão vê o mapa e libera mesas."
      >
        <form onSubmit={criar} className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome" name="nome" required minLength={2} />
          <Campo rotulo="E-mail" name="email" type="email" required />
          <Campo
            rotulo="Senha inicial"
            name="senha"
            type="password"
            required
            minLength={8}
            ajuda="Mínimo de 8 caracteres. Passe para a pessoa pessoalmente."
          />
          <Selecao rotulo="Perfil" name="papel" defaultValue="equipe">
            <option value="equipe">{PAPEIS.equipe}</option>
            <option value="gerente">{PAPEIS.gerente}</option>
            {souAdmin && <option value="dono">{PAPEIS.dono}</option>}
          </Selecao>
          <Botao type="submit" className="sm:col-span-2 sm:justify-self-start">
            Dar acesso
          </Botao>
        </form>
      </Secao>

      <Secao titulo="Quem tem acesso">
        {usuarios === null ? (
          <p className="text-tinta-suave">Carregando...</p>
        ) : (
          <ul className="flex flex-col divide-y divide-linha">
            {usuarios.map((usuario) => {
              const podeMexer = usuario.papel !== "dono" || souAdmin;
              return (
                <li key={usuario.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={`font-semibold ${usuario.ativo ? "" : "line-through opacity-60"}`}
                    >
                      {usuario.nome}
                    </span>
                    <span className="text-sm text-tinta-suave">
                      {PAPEIS[usuario.papel]}, {usuario.email}
                    </span>
                  </span>
                  {podeMexer && (
                    <Botao
                      variante={usuario.ativo ? "perigo" : "secundario"}
                      onClick={() => alternar(usuario)}
                    >
                      {usuario.ativo ? "Tirar acesso" : "Devolver acesso"}
                    </Botao>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Secao>
    </>
  );
}
