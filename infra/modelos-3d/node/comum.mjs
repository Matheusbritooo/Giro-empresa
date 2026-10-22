// Funções pequenas usadas pelos outros scripts.

/** Triângulos de uma malha do glTF-Transform (todas as primitivas). */
export function triangulos(malha) {
  let t = 0;
  for (const p of malha.listPrimitives()) {
    const idx = p.getIndices();
    t += idx ? idx.getCount() / 3 : p.getAttribute("POSITION").getCount() / 3;
  }
  return t;
}
