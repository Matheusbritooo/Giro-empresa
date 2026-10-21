"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Marca } from "@/components/marca";
import { Aviso, Botao, Campo } from "@/components/ui";
import { paginaInicial, useSessao } from "@/lib/sessao";

export default function Entrar() {
  const { sessao, entrar } = useSessao();
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (sessao) router.replace(paginaInicial(sessao.usuario.papel));
  }, [sessao, router]);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    setEnviando(true);
    setErro(null);
    try {
      await entrar(String(dados.get("email")), String(dados.get("senha")));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-10 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Marca tamanho={64} animar />
        <p className="text-lg text-tinta-suave">
          A câmera que já está no teto agora conta o tempo das suas mesas.
        </p>
      </div>
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <Campo rotulo="E-mail" name="email" type="email" autoComplete="username" required />
        <Campo
          rotulo="Senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
        />
        <Aviso>{erro}</Aviso>
        <Botao type="submit" disabled={enviando} className="text-lg">
          {enviando ? "Entrando..." : "Entrar"}
        </Botao>
      </form>
    </main>
  );
}
