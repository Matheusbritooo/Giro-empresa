import { encode } from "uqr";

/**
 * QR desenhado aqui mesmo (uqr só calcula a matriz): nada de HTML de fora entrando na página.
 * Sempre escuro sobre claro, em qualquer tema: a câmera do celular lê mal QR invertido, e é
 * o que vai para a impressora.
 */
export function CodigoQr({ texto, rotulo }: { texto: string; rotulo: string }) {
  const { data, size } = encode(texto, { ecc: "M", border: 2 });
  let caminho = "";
  data.forEach((linha, y) => {
    linha.forEach((preto, x) => {
      if (preto) caminho += `M${x},${y}h1v1h-1z`;
    });
  });
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={rotulo}
      shapeRendering="crispEdges"
      className="block h-auto w-full bg-white text-black"
    >
      <path d={caminho} fill="currentColor" />
    </svg>
  );
}
