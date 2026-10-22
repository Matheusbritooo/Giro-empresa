/**
 * Materiais e texturas do salão: uma cantina à noite, com piso de tábua, parede de reboco
 * creme, lambri verde-garrafa e móveis de madeira escura. Tudo gerado no código, sem baixar
 * arquivo de imagem. Criados uma vez e divididos entre todas as mesas.
 */

import * as THREE from "three";

/** Sorteio repetível: o piso sai igual toda vez que a tela abre. */
function sorteador(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function texturaDeTabuas(): THREE.CanvasTexture {
  const tamanho = 1024;
  const tela = document.createElement("canvas");
  tela.width = tela.height = tamanho;
  const pincel = tela.getContext("2d") as CanvasRenderingContext2D;
  const sorte = sorteador(7);
  const fileiras = 11;
  const altura = tamanho / fileiras;

  for (let f = 0; f < fileiras; f++) {
    let x = -sorte() * 400;
    while (x < tamanho) {
      const comprimento = 300 + sorte() * 420;
      const tom = 22 + sorte() * 9;
      const luz = 21 + sorte() * 9;
      pincel.fillStyle = `hsl(${tom} 34% ${luz}%)`;
      pincel.fillRect(x, f * altura, comprimento, altura);
      // Veios da madeira: linhas finas onduladas, um pouco mais escuras.
      pincel.strokeStyle = `hsl(${tom} 38% ${luz - 6}% / 0.4)`;
      pincel.lineWidth = 1.2;
      for (let v = 0; v < 7; v++) {
        const y0 = f * altura + 8 + sorte() * (altura - 16);
        const onda = 2 + sorte() * 4;
        pincel.beginPath();
        for (let px = 0; px <= comprimento; px += 16) {
          const y = y0 + Math.sin((px + v * 37) / (40 + v * 9)) * onda;
          if (px === 0) pincel.moveTo(x + px, y);
          else pincel.lineTo(x + px, y);
        }
        pincel.stroke();
      }
      // Junta entre tábuas.
      pincel.fillStyle = "rgb(28 18 12 / 0.75)";
      pincel.fillRect(x, f * altura, 2, altura);
      x += comprimento;
    }
    pincel.fillStyle = "rgb(28 18 12 / 0.8)";
    pincel.fillRect(0, f * altura, tamanho, 2);
  }

  const textura = new THREE.CanvasTexture(tela);
  textura.wrapS = textura.wrapT = THREE.RepeatWrapping;
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  return textura;
}

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

const padrao = (cor: string, aspereza = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color: cor, roughness: aspereza, ...extra });

function criar() {
  const tabuas = texturaDeTabuas();
  return {
    tabuas,
    listras: texturaDeListras(),
    piso: new THREE.MeshStandardMaterial({ map: tabuas, roughness: 0.55, metalness: 0 }),
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
    // Pessoas sem rosto e sem cor de pele: o sistema conta gente, não reconhece ninguém.
    argila: padrao("#cbc3b6", 0.85),
    roupas: ["#4b5e6f", "#7c4a39", "#5a6b49", "#8b7a5a", "#3f4a5d", "#6f5a70", "#9b8d7a"].map(
      (cor) => padrao(cor, 0.88),
    ),
    colete: padrao("#22272b", 0.75),
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
    luzQuente: new THREE.MeshBasicMaterial({ color: "#ffd9a0", toneMapped: false }),
  };
}

export type Aparencia = ReturnType<typeof criar>;

let unica: Aparencia | null = null;

/** Os materiais do salão. Criados na primeira vez que o 3D abre. */
export function aparencia(): Aparencia {
  unica ??= criar();
  return unica;
}

/** Cor de roupa sempre igual para a mesma pessoa na mesma mesa, sem sorteio a cada tela. */
export function roupaDe(a: Aparencia, mesa: number, assento: number): THREE.Material {
  return a.roupas[(mesa * 3 + assento * 5) % a.roupas.length];
}
