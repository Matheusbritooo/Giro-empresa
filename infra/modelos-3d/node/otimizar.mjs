// Otimiza um GLB para o painel (three.js 0.186 com GLTFLoader + MeshoptDecoder).
// Uso: node otimizar.mjs <entrada.glb> <saida.glb> '<opções JSON>'
//
// Opções (todas opcionais):
//   tipo: "pessoa" | "decoracao"
//   tex: lado máximo das texturas (padrão 512), viram WebP (EXT_texture_webp)
//   qualidade: qualidade do WebP (padrão 82)
//   triangulos: alvo de triângulos POR MALHA (pessoa: cada pose; o cabelo não entra)
//   simplificar: { "<nome da malha>": razão } (decoração)
//   remover_malhas: ["<começo do nome do nó ou da malha>", ...] (decoração)
//   sem_animacao: true tira as animações (decoração)
//
// Pessoa: o material "cabelo" vira alphaMode MASK (corte 0,5, dupla face); o "avental" do
// garçom, OPAQUE de dupla face; os outros, OPAQUE de uma face. Cores de vértice saem. Nas animações (garçom) ficam só a rotação
// de todos os ossos e a posição da pelve; o resto é a pose de repouso.
// Simplificação com o meshoptimizer: ele só junta vértices ao longo das costuras de UV,
// então a textura não rasga.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  meshopt,
  prune,
  reorder,
  resample,
  simplifyPrimitive,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

import { triangulos } from "./comum.mjs";

const [entrada, saida, opcoesJson = "{}"] = process.argv.slice(2);
const op = JSON.parse(opcoesJson);
const tex = op.tex ?? 512;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const doc = await io.read(entrada);
const raiz = doc.getRoot();

// Luzes e câmeras que vêm nos modelos de exemplo não servem no salão.
for (const ext of raiz.listExtensionsUsed())
  if (ext.extensionName === "KHR_lights_punctual") ext.dispose();
for (const no of raiz.listNodes()) no.setCamera(null);

if (op.remover_malhas) {
  // nome exato ou começo do nome do nó ou da malha
  const tira = (nome) => op.remover_malhas.some((t) => nome.startsWith(t));
  for (const no of raiz.listNodes()) {
    const malha = no.getMesh();
    if (tira(no.getName()) || (malha && tira(malha.getName()))) no.dispose();
  }
}
if (op.sem_animacao) for (const a of raiz.listAnimations()) a.dispose();

if (op.tipo === "pessoa") {
  for (const mat of raiz.listMaterials()) {
    if (mat.getName() === "cabelo") mat.setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true);
    // o avental do garçom é uma folha só: as duas faces aparecem
    else mat.setAlphaMode("OPAQUE").setDoubleSided(mat.getName() === "avental");
    mat.setRoughnessFactor(mat.getName() === "avental" ? 0.9 : 0.75).setMetallicFactor(0);
  }
  for (const malha of raiz.listMeshes())
    for (const prim of malha.listPrimitives())
      for (const sem of prim.listSemantics()) if (sem.startsWith("COLOR_")) prim.setAttribute(sem, null);
  // Animação: só rotação dos ossos e posição da raiz do esqueleto.
  const pelve = raiz.listNodes().find((n) => n.getName() === "Bip01 Pelvis");
  for (const anim of raiz.listAnimations())
    for (const canal of anim.listChannels()) {
      const caminho = canal.getTargetPath();
      const alvo = canal.getTargetNode();
      const manter = caminho === "rotation" || (caminho === "translation" && alvo === pelve);
      if (!manter) {
        const amostrador = canal.getSampler();
        canal.dispose();
        if (amostrador.listParents().filter((p) => p.propertyType !== "Root").length === 0)
          amostrador.dispose();
      }
    }
}

await doc.transform(prune({ keepAttributes: false }), dedup(), weld());

function simplificar(malha, razao) {
  for (const prim of malha.listPrimitives()) {
    if (prim.getMaterial()?.getName() === "cabelo") continue;
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: razao, error: 0.02 });
  }
}

if (op.triangulos) {
  for (const malha of raiz.listMeshes()) {
    const cabelo = malha
      .listPrimitives()
      .filter((p) => p.getMaterial()?.getName() === "cabelo")
      .reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
    const resto = triangulos(malha) - cabelo;
    const alvo = op.triangulos - cabelo;
    if (resto > alvo) simplificar(malha, alvo / resto);
  }
}
if (op.simplificar)
  for (const malha of raiz.listMeshes()) {
    const razao = op.simplificar[malha.getName()];
    if (razao) simplificar(malha, razao);
  }

const passos = [
  prune(),
  textureCompress({
    encoder: sharp,
    targetFormat: "webp",
    resize: [tex, tex],
    quality: op.qualidade ?? 82,
  }),
];
if (raiz.listAnimations().length) passos.push(resample({ tolerance: 1e-4 }));
// Volume de quantização da cena inteira: cada malha com pele não ganha esqueleto próprio
// (o avental e o corpo do garçom dividem o mesmo).
passos.push(
  reorder({ encoder: MeshoptEncoder }),
  meshopt({ encoder: MeshoptEncoder, level: "high", quantizationVolume: "scene" }),
);
await doc.transform(...passos);
await io.write(saida, doc);
console.log("OTIMIZADO", saida);
