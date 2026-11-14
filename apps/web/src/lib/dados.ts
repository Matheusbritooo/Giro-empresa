"use client";

import { useCallback, useEffect, useState } from "react";

// O que cada tela buscou por último fica na memória do aparelho enquanto o painel está aberto.
// Ao voltar para a tela, ela abre na hora com esse dado e atualiza por trás.
// Sai da memória quando alguém entra ou sai da conta: quem pega o aparelho depois não vê nada.
const guardados = new Map<string, unknown>();

export function guardarDado(chave: string, dado: unknown): void {
  guardados.set(chave, dado);
}

export function dadoGuardado<T>(chave: string | null | undefined): T | null {
  return chave ? ((guardados.get(chave) as T | undefined) ?? null) : null;
}

export function limparDados(): void {
  guardados.clear();
}

interface Estado<T> {
  chave: string | null;
  dados: T | null;
  erro: string | null;
}

/**
 * Busca dados ao abrir a tela e quando `recarregar()` é chamado.
 * `buscar` precisa ser estável (useCallback); null = ainda não dá para buscar.
 * Com `chave` (uma por conteúdo: "estoque:1", "pedido:7"), a tela abre com o que foi buscado
 * da última vez e troca pelo dado novo quando ele chega.
 */
export function useDados<T>(buscar: (() => Promise<T>) | null, chave: string | null = null) {
  const [estado, setEstado] = useState<Estado<T>>(() => ({
    chave,
    dados: dadoGuardado<T>(chave),
    erro: null,
  }));
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!buscar) return;
    let ativo = true;
    buscar().then(
      (dados) => {
        if (chave) guardarDado(chave, dados);
        if (ativo) setEstado({ chave, dados, erro: null });
      },
      (erro: Error) => {
        if (!ativo) return;
        // Deu erro: fica o que já estava na tela (ou o guardado), com o aviso por cima.
        setEstado((atual) => ({
          chave,
          dados: atual.chave === chave ? atual.dados : dadoGuardado<T>(chave),
          erro: erro.message,
        }));
      },
    );
    return () => {
      ativo = false;
    };
  }, [buscar, chave, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  // A chave mudou (outro período, outra mesa) e o dado novo ainda não chegou: vale o guardado
  // dessa chave, nunca o da chave anterior.
  const atual = estado.chave === chave ? estado : { dados: dadoGuardado<T>(chave), erro: null };
  return { dados: atual.dados, erro: atual.erro, recarregar };
}
