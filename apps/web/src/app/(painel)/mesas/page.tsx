"use client";

import { useCallback, useState } from "react";

import { Aviso, Botao, Campo, Secao } from "@/components/ui";
import { api } from "@/lib/api";
import { useDados } from "@/lib/dados";
import { useRestauranteAlvo } from "@/lib/restaurante";
import type { Mesa } from "@/lib/tipos";

export default function PaginaMesas() {
  const restaurante = useRestauranteAlvo();
  const [recado, setRecado] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const buscar = useCallback(() => api<Mesa[]>("/api/mesas", { restaurante }), [restaurante]);
  const { dados: mesas, erro, recarregar } = useDados(restaurante ? buscar : null);

  async function criar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const dados = new FormData(formulario);
    try {
      const mesa = await api<Mesa>("/api/mesas", {
        metodo: "POST",
        restaurante,
        corpo: {
          numero: Number(dados.get("numero")),
          lugares: Number(dados.get("lugares")),
          pos_x: Number(dados.get("pos_x")) - 1,
          pos_y: Number(dados.get("pos_y")) - 1,
        },
      });
      setRecado({ tipo: "ok", texto: `Mesa ${mesa.numero} cadastrada.` });
      formulario.reset();
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  async function salvar(mesa: Mesa, mudancas: Partial<Mesa>) {
    try {
      await api(`/api/mesas/${mesa.id}`, { metodo: "PATCH", corpo: mudancas });
      setRecado({ tipo: "ok", texto: `Mesa ${mudancas.numero ?? mesa.numero} atualizada.` });
      recarregar();
    } catch (e) {
      setRecado({ tipo: "erro", texto: (e as Error).message });
    }
  }

  if (!restaurante) return <Aviso>Escolha um restaurante na lista de restaurantes.</Aviso>;

  const proximoNumero = mesas?.length ? Math.max(...mesas.map((m) => m.numero)) + 1 : 1;

  return (
    <>
      <h1 className="font-placa text-4xl font-extrabold leading-none">Mesas do salão</h1>
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      <Aviso>{erro}</Aviso>

      <Secao
        titulo="Cadastrar mesa"
        descricao="Coluna e linha dizem onde a mesa aparece na planta do painel. Comece pela mesa do canto de cima, à esquerda, como se olhasse o salão da porta."
      >
        <form onSubmit={criar} className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
          <Campo
            rotulo="Número"
            name="numero"
            type="number"
            min={1}
            defaultValue={proximoNumero}
            key={proximoNumero}
            required
          />
          <Campo
            rotulo="Lugares"
            name="lugares"
            type="number"
            min={1}
            max={30}
            defaultValue={4}
            required
          />
          <Campo
            rotulo="Coluna"
            name="pos_x"
            type="number"
            min={1}
            max={30}
            defaultValue={1}
            required
          />
          <Campo
            rotulo="Linha"
            name="pos_y"
            type="number"
            min={1}
            max={30}
            defaultValue={1}
            required
          />
          <Botao type="submit" className="col-span-2 sm:col-span-1">
            Cadastrar mesa
          </Botao>
        </form>
      </Secao>

      <Secao
        titulo="Mesas cadastradas"
        descricao="Mesa desativada some da planta, mas o histórico dela continua guardado."
      >
        {mesas === null ? (
          <p className="text-tinta-suave">Carregando...</p>
        ) : mesas.length === 0 ? (
          <p className="text-tinta-suave">Nenhuma mesa ainda. Cadastre a primeira acima.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-linha">
            {mesas.map((mesa) => (
              <LinhaMesa key={mesa.id} mesa={mesa} aoSalvar={salvar} />
            ))}
          </ul>
        )}
      </Secao>
    </>
  );
}

function LinhaMesa({
  mesa,
  aoSalvar,
}: {
  mesa: Mesa;
  aoSalvar: (mesa: Mesa, mudancas: Partial<Mesa>) => void;
}) {
  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    aoSalvar(mesa, {
      numero: Number(dados.get("numero")),
      lugares: Number(dados.get("lugares")),
      pos_x: Number(dados.get("pos_x")) - 1,
      pos_y: Number(dados.get("pos_y")) - 1,
    });
  }

  return (
    <li className={`py-3 ${mesa.ativa ? "" : "opacity-60"}`}>
      <form onSubmit={enviar} className="grid grid-cols-2 gap-3 sm:grid-cols-6 sm:items-end">
        <Campo
          rotulo="Número"
          name="numero"
          type="number"
          min={1}
          defaultValue={mesa.numero}
          required
        />
        <Campo
          rotulo="Lugares"
          name="lugares"
          type="number"
          min={1}
          max={30}
          defaultValue={mesa.lugares}
          required
        />
        <Campo
          rotulo="Coluna"
          name="pos_x"
          type="number"
          min={1}
          max={30}
          defaultValue={mesa.pos_x + 1}
          required
        />
        <Campo
          rotulo="Linha"
          name="pos_y"
          type="number"
          min={1}
          max={30}
          defaultValue={mesa.pos_y + 1}
          required
        />
        <Botao type="submit" variante="secundario">
          Salvar
        </Botao>
        <Botao
          variante={mesa.ativa ? "perigo" : "secundario"}
          onClick={() => aoSalvar(mesa, { ativa: !mesa.ativa })}
        >
          {mesa.ativa ? "Desativar" : "Reativar"}
        </Botao>
      </form>
    </li>
  );
}
