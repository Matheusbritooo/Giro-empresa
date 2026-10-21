"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Busca dados ao abrir a tela e quando `recarregar()` é chamado.
 * `buscar` precisa ser estável (useCallback); null = ainda não dá para buscar.
 */
export function useDados<T>(buscar: (() => Promise<T>) | null) {
  const [estado, setEstado] = useState<{ dados: T | null; erro: string | null }>({
    dados: null,
    erro: null,
  });
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!buscar) return;
    let ativo = true;
    buscar().then(
      (dados) => ativo && setEstado({ dados, erro: null }),
      (erro: Error) => ativo && setEstado((atual) => ({ ...atual, erro: erro.message })),
    );
    return () => {
      ativo = false;
    };
  }, [buscar, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { ...estado, recarregar };
}
