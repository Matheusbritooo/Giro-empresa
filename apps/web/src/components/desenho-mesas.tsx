"use client";

import { useCallback, useEffect, useState } from "react";

import { API_URL, api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import type { Camera, LeituraCamera, Mesa } from "@/lib/tipos";

import { Aviso, Botao } from "./ui";

type Ponto = [number, number];

const ATUALIZAR_MS = 10_000; // a câmera manda uma foto a cada 10 s

function centro(pontos: Ponto[]): Ponto {
  const x = pontos.reduce((soma, p) => soma + p[0], 0) / pontos.length;
  const y = pontos.reduce((soma, p) => soma + p[1], 0) / pontos.length;
  return [x, y];
}

const emPorcentagem = ([x, y]: Ponto) => ({ left: `${x * 100}%`, top: `${y * 100}%` });

/** Prévia da câmera com o desenho das mesas e o que a visão está enxergando agora. */
export function DesenhoDeMesas({
  camera,
  mesas,
  aoMudarMesas,
}: {
  camera: Camera;
  mesas: Mesa[];
  aoMudarMesas: () => void;
}) {
  const [versao, setVersao] = useState(0);
  const [desenho, setDesenho] = useState<{ mesa: Mesa; pontos: Ponto[] } | null>(null);
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);

  useEffect(() => {
    const id = setInterval(() => setVersao((v) => v + 1), ATUALIZAR_MS);
    return () => clearInterval(id);
  }, []);

  const buscarLeitura = useCallback(
    () => api<LeituraCamera>(`/api/cameras/${camera.id}/leitura?v=${versao}`),
    [camera.id, versao],
  );
  const leitura = useDados(buscarLeitura);
  const temImagem = leitura.dados !== null && leitura.erro === null;

  const desenhadas = mesas.filter((m) => m.camera_id === camera.id && m.poligono);
  const contagem = new Map(leitura.dados?.mesas.map((m) => [m.mesa, m]));

  function adicionarPonto(evento: React.MouseEvent<HTMLDivElement>) {
    if (!desenho) return;
    const area = evento.currentTarget.getBoundingClientRect();
    const x = (evento.clientX - area.left) / area.width;
    const y = (evento.clientY - area.top) / area.height;
    const ponto: Ponto = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
    setDesenho({ ...desenho, pontos: [...desenho.pontos, ponto] });
  }

  async function salvar(mesa: Mesa, poligono: Ponto[] | null) {
    try {
      await api(`/api/mesas/${mesa.id}`, {
        metodo: "PATCH",
        corpo: { poligono, camera_id: poligono ? camera.id : null },
      });
      setDesenho(null);
      setRecado({
        tipo: "ok",
        texto: poligono
          ? `Desenho da mesa ${mesa.numero} salvo. A contagem aparece em até 30 segundos.`
          : `Desenho da mesa ${mesa.numero} apagado.`,
      });
      aoMudarMesas();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="flex flex-col gap-3">
        {temImagem ? (
          <div
            className={`relative overflow-hidden rounded-xl border border-linha ${desenho ? "cursor-crosshair" : ""}`}
            onClick={adicionarPonto}
            data-testid="previa-camera"
          >
            {/* A prévia vem da API com o cookie de sessão: o otimizador de imagens do Next não teria o cookie. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${API_URL}/api/cameras/${camera.id}/previa?v=${versao}`}
              alt={`Última foto da câmera ${camera.nome}, com as pessoas pixeladas`}
              className="block w-full select-none"
              draggable={false}
            />
            <svg
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden
            >
              {desenhadas.map((m) =>
                m.id === desenho?.mesa.id ? null : (
                  <polygon
                    key={m.id}
                    points={(m.poligono as Ponto[]).map((p) => p.join(",")).join(" ")}
                    fill="color-mix(in srgb, var(--ocupada) 22%, transparent)"
                    stroke="var(--ocupada)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
              {leitura.dados?.pessoas.map((p, i) => (
                <rect
                  key={i}
                  x={p.x1}
                  y={p.y1}
                  width={p.x2 - p.x1}
                  height={p.y2 - p.y1}
                  fill="none"
                  stroke={p.em_pe ? "var(--aguardando)" : "#ffffff"}
                  strokeWidth={2}
                  strokeDasharray={p.mesa === null ? "4 3" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {desenho && desenho.pontos.length > 0 && (
                <polyline
                  points={[
                    ...desenho.pontos,
                    ...(desenho.pontos.length > 2 ? [desenho.pontos[0]] : []),
                  ]
                    .map((p) => p.join(","))
                    .join(" ")}
                  fill="color-mix(in srgb, var(--aguardando) 25%, transparent)"
                  stroke="var(--aguardando)"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {desenhadas.map((m) =>
              m.id === desenho?.mesa.id ? null : (
                <span
                  key={m.id}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-ocupada px-1.5 font-placa text-xl font-extrabold leading-tight text-sobre-cor"
                  style={emPorcentagem(centro(m.poligono as Ponto[]))}
                >
                  {m.numero}
                </span>
              ),
            )}
            {desenho?.pontos.map((p, i) => (
              <span
                key={i}
                className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-aguardando"
                style={emPorcentagem(p)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-linha p-6">
            <p className="font-semibold">Ainda não chegou imagem desta câmera.</p>
            <p className="text-tinta-suave">
              Ligue o conector GIRO num computador na mesma rede do gravador, com a chave desta
              câmera. A primeira foto aparece aqui em até 10 segundos.
            </p>
            {leitura.erro && !leitura.erro.includes("conector") && (
              <p className="mt-2 text-sm text-tinta-suave">Detalhe: {leitura.erro}</p>
            )}
          </div>
        )}
        <p className="text-sm text-tinta-suave">
          Contorno azul: mesa desenhada. Caixa branca: pessoa sentada. Caixa amarela: pessoa em pé.
          Tracejada: fora de qualquer mesa. As pessoas aparecem pixeladas e a foto não fica
          guardada.
        </p>
      </div>

      <aside className="flex flex-col gap-3">
        {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
        {desenho ? (
          <div className="flex flex-col gap-3 rounded-xl border-l-[6px] border-aguardando bg-superficie p-4">
            <p className="font-semibold">Desenhando a mesa {desenho.mesa.numero}</p>
            <p className="text-sm text-tinta-suave">
              Toque na foto em volta da mesa, cobrindo também as cadeiras, um canto de cada vez.
              Bastam 4 pontos para uma mesa retangular.
            </p>
            <p className="numeros text-sm" role="status">
              {desenho.pontos.length} ponto(s)
            </p>
            <div className="flex flex-wrap gap-2">
              <Botao
                disabled={desenho.pontos.length < 3}
                onClick={() => salvar(desenho.mesa, desenho.pontos)}
              >
                Salvar desenho
              </Botao>
              <Botao
                variante="secundario"
                disabled={desenho.pontos.length === 0}
                onClick={() => setDesenho({ ...desenho, pontos: desenho.pontos.slice(0, -1) })}
              >
                Desfazer ponto
              </Botao>
              <Botao variante="secundario" onClick={() => setDesenho(null)}>
                Cancelar
              </Botao>
            </div>
          </div>
        ) : null}

        <ul className="flex flex-col divide-y divide-linha" aria-label="Mesas do salão">
          {mesas
            .filter((m) => m.ativa)
            .map((mesa) => {
              const aqui = mesa.camera_id === camera.id && mesa.poligono;
              const outra = mesa.camera_id !== null && mesa.camera_id !== camera.id;
              const lida = contagem.get(mesa.numero);
              return (
                <li
                  key={mesa.id}
                  className="flex items-center gap-3 py-2"
                  data-testid={`linha-mesa-${mesa.numero}`}
                >
                  <span className="w-10 font-placa text-2xl font-extrabold">{mesa.numero}</span>
                  <span className="flex min-w-0 flex-1 flex-col text-sm leading-snug">
                    <span className="font-semibold">
                      {aqui ? "Desenhada" : outra ? "Em outra câmera" : "Sem desenho"}
                    </span>
                    {aqui && lida && (
                      <span
                        className="numeros whitespace-nowrap text-tinta-suave"
                        data-testid={`leitura-${mesa.numero}`}
                      >
                        {lida.sentados} {lida.sentados === 1 ? "sentado" : "sentados"}, {lida.em_pe}{" "}
                        em pé
                      </span>
                    )}
                  </span>
                  {!desenho && temImagem && (
                    <Botao
                      variante="secundario"
                      className="min-h-9 px-3 text-sm"
                      onClick={() => {
                        setRecado(null);
                        setDesenho({ mesa, pontos: [] });
                      }}
                    >
                      {aqui ? "Redesenhar" : "Desenhar"}
                    </Botao>
                  )}
                  {!desenho && aqui && (
                    <Botao
                      variante="perigo"
                      className="min-h-9 px-3 text-sm"
                      onClick={() => salvar(mesa, null)}
                    >
                      Apagar
                    </Botao>
                  )}
                </li>
              );
            })}
        </ul>
      </aside>
    </div>
  );
}
