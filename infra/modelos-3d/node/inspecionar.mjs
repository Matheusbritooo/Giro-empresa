// Resumo de um ou mais GLB: tamanho, triângulos por malha, materiais, texturas, extensões.
// Uso: node inspecionar.mjs <arquivo.glb>...
import fs from "node:fs";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

import { triangulos } from "./comum.mjs";

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

for (const caminho of process.argv.slice(2)) {
  const doc = await io.read(caminho);
  const raiz = doc.getRoot();
  console.log(`== ${caminho} ${fs.statSync(caminho).size} bytes`);
  console.log("  extensões:", raiz.listExtensionsUsed().map((e) => e.extensionName).join(", "));
  for (const m of raiz.listMeshes())
    console.log(
      `  malha ${m.getName()}: ${triangulos(m)} triângulos, ${m.listPrimitives().length} primitivas`,
    );
  for (const m of raiz.listMaterials())
    console.log(`  material ${m.getName()}: ${m.getAlphaMode()} duplo=${m.getDoubleSided()}`);
  for (const t of raiz.listTextures()) {
    const tam = t.getSize();
    console.log(`  textura ${t.getName()} ${t.getMimeType()} ${tam?.join("x")} ${t.getImage()?.byteLength} bytes`);
  }
  for (const a of raiz.listAnimations()) {
    let fim = 0;
    let ini = Infinity;
    for (const s of a.listSamplers()) {
      fim = Math.max(fim, s.getInput().getMax([])[0]);
      ini = Math.min(ini, s.getInput().getMin([])[0]);
    }
    console.log(
      `  animação ${a.getName()}: ${ini.toFixed(3)} a ${fim.toFixed(3)} s, ${a.listChannels().length} canais`,
    );
  }
  for (const s of raiz.listSkins()) console.log(`  esqueleto ${s.listJoints().length} ossos`);
}
