/** "giro" com o "o" desenhado como mesa redonda com quatro cadeiras. */
export function Marca({ tamanho = 28, animar = false }: { tamanho?: number; animar?: boolean }) {
  const mesa = tamanho * 0.78;
  return (
    <span
      className="inline-flex items-baseline font-placa font-extrabold leading-none tracking-tight text-tinta"
      style={{ fontSize: tamanho }}
      aria-label="giro"
      role="img"
    >
      <span aria-hidden>gir</span>
      <svg
        aria-hidden
        viewBox="0 0 40 40"
        width={mesa}
        height={mesa}
        className={animar ? "giro-abrir ml-[0.04em] self-center" : "ml-[0.04em] self-center"}
      >
        <circle cx="20" cy="20" r="10.5" fill="none" stroke="currentColor" strokeWidth="5" />
        <circle cx="20" cy="3.5" r="3.5" fill="var(--aguardando)" />
        <circle cx="36.5" cy="20" r="3.5" fill="currentColor" />
        <circle cx="20" cy="36.5" r="3.5" fill="currentColor" />
        <circle cx="3.5" cy="20" r="3.5" fill="currentColor" />
      </svg>
    </span>
  );
}
