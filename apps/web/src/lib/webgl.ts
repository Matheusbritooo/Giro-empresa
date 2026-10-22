let resposta: boolean | undefined;

/** O aparelho consegue desenhar 3D? Celular antigo ou navegador com aceleração desligada, não. */
export function temWebGL(): boolean {
  if (typeof document === "undefined") return false;
  resposta ??= testar(); // testa uma vez só: cada teste abre um contexto de vídeo
  return resposta;
}

function testar(): boolean {
  try {
    const tela = document.createElement("canvas");
    const contexto = tela.getContext("webgl2") ?? tela.getContext("webgl");
    contexto?.getExtension("WEBGL_lose_context")?.loseContext(); // devolve o contexto na hora
    return contexto !== null;
  } catch {
    return false;
  }
}
