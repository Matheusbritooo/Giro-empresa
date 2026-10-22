/**
 * Lado do three das texturas geradas no código: gera aos poucos, nos intervalos em que o
 * navegador está à toa (requestIdleCallback, ou fatias curtas com setTimeout), embrulha os
 * bytes em DataTexture e guarda no módulo. Abrir o 3D de novo não gera tudo outra vez.
 */

import * as THREE from "three";

import { type GeracaoFatiada, gerarTextura, type MapasPBR, type NomeTextura } from "./texturas-pbr";

export interface TexturasPBR {
  /** Cor (sRGB). */
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  /** Oclusão no R e aspereza no G: serve de aoMap e de roughnessMap. */
  orm: THREE.DataTexture;
  tamanho: number;
}

const guardadas = new Map<string, Promise<TexturasPBR>>();

/** Quanto tempo cada fatia pode ocupar o processador quando não há requestIdleCallback. */
const FATIA_MS = 8;

type Agendar = (passo: (tempoLivre: () => number) => void) => void;

const agendar: Agendar = (passo) => {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(
      (prazo) => {
        // Sem folga (o prazo venceu): ainda assim anda uma fatia de tempo, não uma fatia de linhas.
        const inicio = performance.now();
        passo(() =>
          prazo.didTimeout ? FATIA_MS - (performance.now() - inicio) : prazo.timeRemaining(),
        );
      },
      { timeout: 200 },
    );
  } else {
    setTimeout(() => {
      const inicio = performance.now();
      passo(() => FATIA_MS - (performance.now() - inicio));
    }, 0);
  }
};

/** Roda uma geração fatiada até o fim, sem travar a tela. */
export function gerarAosPoucos(geracao: GeracaoFatiada): Promise<MapasPBR> {
  return new Promise((resolver, rejeitar) => {
    const continuar = (tempoLivre: () => number) => {
      try {
        // Sempre anda pelo menos uma fatia, mesmo com o navegador ocupado (o timeout venceu).
        do {
          const passo = geracao.next();
          if (passo.done) {
            resolver(passo.value);
            return;
          }
        } while (tempoLivre() > 2);
        agendar(continuar);
      } catch (erro) {
        rejeitar(erro);
      }
    };
    agendar(continuar);
  });
}

function embrulhar(dados: Uint8Array, tamanho: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(
    dados,
    tamanho,
    tamanho,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** As texturas prontas para o material (geradas uma vez por nome e tamanho). */
export function texturasPBR(nome: NomeTextura, tamanho: number): Promise<TexturasPBR> {
  const chave = `${nome}:${tamanho}`;
  let pronta = guardadas.get(chave);
  if (!pronta) {
    pronta = gerarAosPoucos(gerarTextura(nome, tamanho)).then((m) => ({
      map: embrulhar(m.cor, m.tamanho, true),
      normalMap: embrulhar(m.normal, m.tamanho, false),
      orm: embrulhar(m.orm, m.tamanho, false),
      tamanho: m.tamanho,
    }));
    pronta.catch(() => guardadas.delete(chave)); // tenta de novo na próxima vez
    guardadas.set(chave, pronta);
  }
  return pronta;
}

export interface OpcoesVestir {
  /** Força do relevo (normalScale). */
  relevo?: number;
  /** Quanto a oclusão do mapa escurece a luz de ambiente. */
  oclusao?: number;
}

/** Põe as texturas num material que já está na tela (troca o desenho sem recriar nada). */
export function vestir(
  material: THREE.MeshStandardMaterial,
  texturas: TexturasPBR,
  { relevo = 1, oclusao = 0.6 }: OpcoesVestir = {},
): void {
  material.map = texturas.map;
  material.normalMap = texturas.normalMap;
  material.normalScale.set(relevo, relevo);
  material.roughnessMap = texturas.orm;
  material.aoMap = texturas.orm;
  material.aoMapIntensity = oclusao;
  material.roughness = 1; // a aspereza vem toda do mapa
  material.needsUpdate = true;
}
