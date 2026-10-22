/**
 * Materiais e texturas do salão: uma cantina à noite, com piso de tábua envernizada, parede
 * de reboco creme, lambri verde-garrafa, móveis de madeira escura e toalha xadrez. Tudo
 * gerado no código, sem baixar arquivo de imagem. Criados uma vez e divididos entre todas
 * as mesas; as texturas PBR chegam depois (`vestirSalao`), geradas aos poucos.
 */

import * as THREE from "three";

import { texturasPBR, vestir } from "./texturas-three";

/** Listras diagonais: o "hachurado" da mesa para limpar, igual ao da planta. */
function texturaDeListras(): THREE.CanvasTexture {
  const tamanho = 64;
  const tela = document.createElement("canvas");
  tela.width = tela.height = tamanho;
  const pincel = tela.getContext("2d") as CanvasRenderingContext2D;
  pincel.fillStyle = "#ffffff";
  pincel.fillRect(0, 0, tamanho, tamanho);
  pincel.strokeStyle = "#8a8a8a";
  pincel.lineWidth = 14;
  for (let i = -tamanho; i <= tamanho * 2; i += 32) {
    pincel.beginPath();
    pincel.moveTo(i, 0);
    pincel.lineTo(i - tamanho, tamanho);
    pincel.stroke();
  }
  const textura = new THREE.CanvasTexture(tela);
  textura.wrapS = textura.wrapT = THREE.RepeatWrapping;
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.repeat.set(3, 3); // a geometria do tapete usa metros como coordenada da textura
  return textura;
}

/** Mancha redonda e macia: sombra de contato desenhada, para quando não há sombra projetada. */
function texturaDeSombra(): THREE.CanvasTexture {
  const tamanho = 128;
  const tela = document.createElement("canvas");
  tela.width = tela.height = tamanho;
  const pincel = tela.getContext("2d") as CanvasRenderingContext2D;
  const meio = tamanho / 2;
  const degrade = pincel.createRadialGradient(meio, meio, 0, meio, meio, meio);
  degrade.addColorStop(0, "rgb(0 0 0 / 0.5)");
  degrade.addColorStop(0.55, "rgb(0 0 0 / 0.34)");
  degrade.addColorStop(1, "rgb(0 0 0 / 0)");
  pincel.fillStyle = degrade;
  pincel.fillRect(0, 0, tamanho, tamanho);
  return new THREE.CanvasTexture(tela);
}

const padrao = (cor: string, aspereza = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color: cor, roughness: aspereza, ...extra });

function criar() {
  return {
    listras: texturaDeListras(),
    sombraContato: new THREE.MeshBasicMaterial({
      map: texturaDeSombra(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
    // Até a textura ficar pronta, o piso é só da cor média da madeira.
    piso: padrao("#5e3b25", 0.5),
    reboco: padrao("#e2d3ba", 0.95),
    lambri: padrao("#2d4a3e", 0.7),
    friso: padrao("#5b3a24", 0.5),
    // Tampo envernizado: o verniz reflete as luzes do salão.
    tampo: new THREE.MeshPhysicalMaterial({
      color: "#6b4127",
      roughness: 0.42,
      clearcoat: 0.55,
      clearcoatRoughness: 0.25,
    }),
    madeiraEscura: padrao("#3b2417", 0.62),
    // Toalha de algodão: o "sheen" dá o brilho aveludado de tecido nas bordas.
    toalha: new THREE.MeshPhysicalMaterial({
      color: "#e4cdc5",
      roughness: 0.9,
      sheen: 0.6,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color("#fff4ea"),
      side: THREE.DoubleSide, // por baixo da barra também se vê o pano
    }),
    metal: padrao("#2b2a28", 0.35, { metalness: 0.85 }),
    louca: padrao("#f3efe6", 0.22),
    vidro: new THREE.MeshPhysicalMaterial({
      color: "#e4efec",
      roughness: 0.05,
      transparent: true,
      opacity: 0.32,
      envMapIntensity: 1.6,
    }),
    vinho: padrao("#5a0f1c", 0.15, { transparent: true, opacity: 0.88 }),
    agua: new THREE.MeshPhysicalMaterial({
      color: "#cfe3ea",
      roughness: 0.05,
      transparent: true,
      opacity: 0.45,
    }),
    molho: padrao("#b3402a", 0.55),
    massa: padrao("#e1bf78", 0.7),
    guardanapo: padrao("#eee8db", 0.9),
    cardapio: padrao("#6a1d1d", 0.55),
    // Pessoas simples (reserva enquanto os modelos realistas baixam): sem rosto, cor de argila.
    argila: padrao("#cbc3b6", 0.85),
    roupas: ["#4b5e6f", "#7c4a39", "#5a6b49", "#8b7a5a", "#3f4a5d", "#6f5a70", "#9b8d7a"].map(
      (cor) => padrao(cor, 0.88),
    ),
    avental: padrao("#ebe5d8", 0.9),
    pedra: padrao("#2f2c29", 0.32),
    garrafaVerde: padrao("#2f5a3a", 0.1, { transparent: true, opacity: 0.8 }),
    garrafaAmbar: padrao("#8a5419", 0.1, { transparent: true, opacity: 0.8 }),
    terracota: padrao("#a4572f", 0.85),
    folhas: padrao("#3c6a3a", 0.75, { flatShading: true }),
    noite: new THREE.MeshStandardMaterial({
      color: "#0e1726",
      emissive: "#1d3458",
      emissiveIntensity: 0.55,
      roughness: 0.1,
    }),
    // Cúpula da arandela: brilha acima de 1, que é o que o brilho (bloom) pega.
    luzQuente: new THREE.MeshStandardMaterial({
      color: "#000000",
      emissive: "#ffd9a0",
      emissiveIntensity: 3.2,
      side: THREE.DoubleSide,
    }),
    latao: padrao("#a7834a", 0.32, { metalness: 0.9 }),
  };
}

/** 1 pixel neutro: o shader nasce com os mapas e não recompila quando a textura chega. */
function pixel(r: number, g: number, b: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
function neutro(m: THREE.MeshStandardMaterial) {
  m.map = pixel(255, 255, 255, true);
  m.normalMap = pixel(128, 128, 255, false);
  const orm = pixel(255, Math.round(m.roughness * 255), 0, false);
  m.roughnessMap = orm;
  m.aoMap = orm;
  m.roughness = 1;
}
function criarComNeutros() {
  const a = criar();
  for (const m of [a.piso, a.reboco, a.lambri, a.tampo, a.madeiraEscura, a.friso, a.toalha])
    neutro(m);
  return a;
}

export type Aparencia = ReturnType<typeof criar>;

let unica: Aparencia | null = null;

/** Os materiais do salão. Criados na primeira vez que o 3D abre. */
export function aparencia(): Aparencia {
  unica ??= criarComNeutros();
  return unica;
}

/** Lado das texturas já vestidas (0 = nenhuma). Nunca troca por uma menor. */
let vestidas = 0;

/**
 * Gera as texturas PBR (aos poucos) e veste os materiais do salão com elas. Resolve quando
 * terminou, para quem chamou pedir um quadro novo.
 */
export async function vestirSalao(tamanho: number): Promise<boolean> {
  if (vestidas >= tamanho) return false;
  const a = aparencia();
  const [piso, reboco, lambri, madeira, toalha] = await Promise.all([
    texturasPBR("piso", tamanho),
    texturasPBR("reboco", tamanho),
    texturasPBR("lambri", tamanho),
    texturasPBR("madeira", tamanho),
    texturasPBR("toalha", tamanho),
  ]);
  if (vestidas >= tamanho) return false;
  vestidas = tamanho;
  a.piso.color.set("#ffffff"); // a cor da tábua já vem na textura
  vestir(a.piso, piso, { relevo: 0.9, oclusao: 0.7 });
  vestir(a.reboco, reboco, { relevo: 0.6, oclusao: 0.4 });
  vestir(a.lambri, lambri, { relevo: 1, oclusao: 0.7 });
  for (const m of [a.tampo, a.madeiraEscura, a.friso]) vestir(m, madeira, { relevo: 0.5 });
  a.toalha.color.set("#ffffff"); // o xadrez já vem na textura
  vestir(a.toalha, toalha, { relevo: 0.7, oclusao: 0.5 });
  return true;
}

/** Cor de roupa sempre igual para a mesma pessoa na mesma mesa, sem sorteio a cada tela. */
export function roupaDe(a: Aparencia, mesa: number, assento: number): THREE.Material {
  return a.roupas[(mesa * 3 + assento * 5) % a.roupas.length];
}
