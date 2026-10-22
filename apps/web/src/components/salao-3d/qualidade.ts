/**
 * Quanto acabamento o salão 3D liga em cada aparelho. A escolha sai do nome da placa de
 * vídeo, do número de núcleos, da memória e da tela de toque, antes de montar o 3D; depois
 * o `PerformanceMonitor` baixa um nível se a imagem começar a travar.
 *
 * - "alto": computador com placa de vídeo de verdade. Oclusão de ambiente, brilho nas
 *   luminárias, sombras que acompanham quem se mexe, texturas de 512 px.
 * - "medio": celular bom ou placa integrada. Sem oclusão, sombra refeita só quando o salão muda.
 * - "baixo": celular fraco e computador sem aceleração (SwiftShader, llvmpipe, a CI). Sem
 *   pós-processamento, sem sombra projetada (fica uma sombra de contato desenhada) e só
 *   desenha quando algo muda.
 *
 * Dá para forçar com `?qualidade=baixo|medio|alto` na URL ou guardando o nível em
 * `localStorage["giro:qualidade-3d"]` (a URL ganha).
 */

export type Nivel = "alto" | "medio" | "baixo";

export const NIVEIS: readonly Nivel[] = ["baixo", "medio", "alto"];

export const CHAVE_QUALIDADE = "giro:qualidade-3d";

/** O que se sabe do aparelho. Tudo opcional menos o nome da placa: navegador esconde muito. */
export interface InfoAparelho {
  /** Nome da placa de vídeo (WEBGL_debug_renderer_info), ou "" se não deu para ler. */
  placa: string;
  /** O navegador recusou um contexto com `failIfMajorPerformanceCaveat` (desenho por software). */
  semAceleracao?: boolean;
  /** navigator.hardwareConcurrency */
  nucleos?: number;
  /** navigator.deviceMemory, em GB (só Chrome; arredondado para baixo pelo navegador). */
  memoriaGb?: number;
  /** Tela de toque como forma principal de apontar (celular, tablet). */
  toque?: boolean;
  /** Valor de `?qualidade=` na URL. */
  forcadoNaUrl?: string | null;
  /** Valor guardado em `localStorage`. */
  forcadoGuardado?: string | null;
}

export interface Ajustes {
  /** EffectComposer (brilho, tom ACES, vinheta, SMAA). */
  efeitos: boolean;
  /** Oclusão de ambiente (N8AO em meia resolução). */
  oclusao: boolean;
  /** "dinamicas": refaz a cada quadro; "estaticas": só quando o salão muda; "nenhuma": sem sombra projetada. */
  sombras: "dinamicas" | "estaticas" | "nenhuma";
  /** Tamanho do mapa de sombra, quando há sombra. */
  mapaSombra: number;
  /** Pulso da mesa atrasada, LED e varredura da câmera. Sem isso, o Canvas só desenha sob demanda. */
  animar: boolean;
  /** Densidade de pixels do Canvas. */
  dpr: number | [number, number];
  /** Lado das texturas geradas no código. */
  texturas: 256 | 512;
}

const AJUSTES: Record<Nivel, Ajustes> = {
  alto: {
    efeitos: true,
    oclusao: true,
    sombras: "dinamicas",
    mapaSombra: 2048,
    animar: true,
    dpr: [1, 2],
    texturas: 512,
  },
  medio: {
    efeitos: true,
    oclusao: false,
    sombras: "estaticas",
    mapaSombra: 1024,
    animar: true,
    dpr: [1, 1.5],
    texturas: 256,
  },
  baixo: {
    efeitos: false,
    oclusao: false,
    sombras: "nenhuma",
    mapaSombra: 0,
    animar: false,
    dpr: 1,
    texturas: 256,
  },
};

export function ajustesDoNivel(nivel: Nivel): Ajustes {
  return AJUSTES[nivel];
}

/** Um nível abaixo (o "baixo" fica onde está). */
export function nivelAbaixo(nivel: Nivel): Nivel {
  return NIVEIS[Math.max(0, NIVEIS.indexOf(nivel) - 1)];
}

export function lerNivel(valor: string | null | undefined): Nivel | null {
  const v = valor?.trim().toLowerCase();
  if (v === "medio" || v === "médio") return "medio";
  return v === "alto" || v === "baixo" ? v : null;
}

/** Nível escolhido à mão (URL primeiro, depois o guardado), ou null se é para decidir sozinho. */
export function nivelForcado(info: InfoAparelho): Nivel | null {
  return lerNivel(info.forcadoNaUrl) ?? lerNivel(info.forcadoGuardado);
}

/** Desenho por software: o processador faz o papel da placa de vídeo. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|microsoft basic/i;
/** Placas de celular de entrada (Mali antigas, Adreno 3xx/4xx/50x, PowerVR antigas). */
const CELULAR_FRACO =
  /mali-(4\d\d|t[678]\d\d|g31|g51|g52)|adreno.{0,8}\b(3\d\d|4\d\d|50\d)\b|powervr (sgx|rogue ge)/i;
/** Integradas de computador que aguentam o "medio", mas não a oclusão do "alto". */
const INTEGRADA = /intel.*\b(hd|uhd) graphics\b|intel\(r\) graphics|mali|adreno/i;

/** Decide o nível só com os dados do aparelho (sem tocar no navegador: dá para testar). */
export function escolherNivel(info: InfoAparelho): Nivel {
  const forcado = nivelForcado(info);
  if (forcado) return forcado;

  const placa = info.placa ?? "";
  if (info.semAceleracao || SOFTWARE.test(placa)) return "baixo";

  const nucleos = info.nucleos ?? 4;
  const memoria = info.memoriaGb ?? 4;
  if (nucleos <= 2 || memoria <= 2) return "baixo";

  if (info.toque) {
    if (CELULAR_FRACO.test(placa) || nucleos <= 4 || memoria <= 3) return "baixo";
    return "medio";
  }
  if (nucleos <= 4 || memoria <= 4 || INTEGRADA.test(placa)) return "medio";
  return "alto";
}

let sondado: InfoAparelho | null = null;

/** Lê o aparelho uma vez (cada leitura abre e devolve um contexto de vídeo). */
export function sondarNavegador(): InfoAparelho {
  if (sondado) return sondado;
  const info: InfoAparelho = { placa: "" };
  if (typeof window === "undefined") return info;

  try {
    info.forcadoNaUrl = new URLSearchParams(window.location.search).get("qualidade");
  } catch {
    info.forcadoNaUrl = null;
  }
  try {
    info.forcadoGuardado = window.localStorage.getItem(CHAVE_QUALIDADE);
  } catch {
    info.forcadoGuardado = null; // navegador sem armazenamento
  }
  info.nucleos = navigator.hardwareConcurrency || undefined;
  info.memoriaGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  try {
    info.toque = window.matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
  } catch {
    info.toque = false;
  }

  try {
    const tela = document.createElement("canvas");
    const gl2 = tela.getContext("webgl2");
    const gl = gl2 ?? tela.getContext("webgl");
    if (gl) {
      // Chrome e Firefox novos já põem o nome bom no RENDERER; Safari diz só "Apple GPU".
      const extensao = gl.getExtension("WEBGL_debug_renderer_info");
      info.placa = String(
        gl.getParameter(extensao ? extensao.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "",
      );
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      const outra = document.createElement("canvas");
      const exigente = gl2
        ? outra.getContext("webgl2", { failIfMajorPerformanceCaveat: true })
        : outra.getContext("webgl", { failIfMajorPerformanceCaveat: true });
      info.semAceleracao = exigente === null;
      exigente?.getExtension("WEBGL_lose_context")?.loseContext();
    } else {
      info.semAceleracao = true;
    }
  } catch {
    info.semAceleracao = true;
  }

  sondado = info;
  return info;
}
