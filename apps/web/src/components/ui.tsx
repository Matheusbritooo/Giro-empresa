import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

type Variante = "principal" | "secundario" | "perigo";

const VARIANTES: Record<Variante, string> = {
  principal: "bg-tinta text-fundo hover:opacity-90",
  secundario: "border border-linha bg-superficie text-tinta hover:border-tinta-suave",
  perigo: "border border-atrasada text-atrasada hover:bg-atrasada hover:text-sobre-cor",
};

export function Botao({
  variante = "principal",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTES[variante]} ${className}`}
      {...props}
    />
  );
}

export function Campo({
  rotulo,
  ajuda,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; ajuda?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {rotulo}
      <input
        className="min-h-11 rounded-lg border border-linha bg-superficie px-3 text-base font-normal text-tinta placeholder:text-tinta-suave/70"
        {...props}
      />
      {ajuda && <span className="text-xs font-normal text-tinta-suave">{ajuda}</span>}
    </label>
  );
}

export function Selecao({
  rotulo,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { rotulo: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {rotulo}
      <select
        className="min-h-11 rounded-lg border border-linha bg-superficie px-3 text-base font-normal text-tinta"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Aviso({
  tipo = "erro",
  children,
}: {
  tipo?: "erro" | "ok";
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <p
      role={tipo === "erro" ? "alert" : "status"}
      className={`rounded-lg border-l-4 bg-superficie px-3 py-2 text-sm ${
        tipo === "erro" ? "border-atrasada" : "border-ocupada"
      }`}
    >
      {children}
    </p>
  );
}

export function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-linha pt-6 first:border-t-0 first:pt-0">
      <header className="max-w-prose">
        <h2 className="font-placa text-2xl font-bold">{titulo}</h2>
        {descricao && <p className="text-tinta-suave">{descricao}</p>}
      </header>
      {children}
    </section>
  );
}

export const PAPEIS: Record<string, string> = {
  admin_giro: "Equipe GIRO",
  dono: "Dono",
  gerente: "Gerente",
  equipe: "Equipe do salão",
};

/**
 * Lugar reservado enquanto o dado não chega: blocos no formato do que vem, em vez de uma frase
 * "Carregando...". `formato="cartoes"` para telas de números; o padrão é uma lista.
 */
export function Esqueleto({
  linhas = 4,
  formato = "lista",
  rotulo = "Carregando",
}: {
  linhas?: number;
  formato?: "lista" | "cartoes";
  rotulo?: string;
}) {
  const blocos = Array.from({ length: linhas }, (_, i) => i);
  return (
    <div role="status" className="animate-pulse motion-reduce:animate-none">
      <span className="sr-only">{rotulo}...</span>
      {formato === "cartoes" ? (
        <div aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {blocos.map((i) => (
            <div key={i} className="h-24 rounded-xl bg-linha/60" />
          ))}
        </div>
      ) : (
        <div aria-hidden className="flex flex-col gap-3">
          {blocos.map((i) => (
            <div
              key={i}
              className={`h-12 rounded-xl bg-linha/60 ${["w-full", "w-11/12", "w-4/5"][i % 3]}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
