// Escreve <destino>/manifesto.json a partir do config, das medidas do Blender e dos GLB finais.
// Uso: node manifesto.mjs <config.json> <pasta_bruto> <destino>
import fs from "node:fs";
import path from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

import { triangulos } from "./comum.mjs";

const [configPath, bruto, destino] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const lerJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const bytes = (rel) => fs.statSync(path.join(destino, rel)).size;
const r3 = (v) => Math.round(v * 1000) / 1000;

async function trisPorMalha(rel) {
  const doc = await io.read(path.join(destino, rel));
  return Object.fromEntries(doc.getRoot().listMeshes().map((m) => [m.getName(), triangulos(m)]));
}

const clientes = [];
for (const c of config.clientes) {
  const arquivo = `pessoas/cliente-${c.id}.glb`;
  const tris = await trisPorMalha(arquivo);
  const med = lerJson(path.join(bruto, `${c.id}.json`));
  clientes.push({
    id: c.id,
    arquivo,
    sexo: c.sexo,
    poses: ["pose_0", "pose_1", "pose_2"],
    papeis: Object.fromEntries(med.poses.map((p) => [p.nome, p.papel])),
    altura: c.altura,
    triangulos: Math.max(...Object.values(tris)),
    triangulos_por_pose: tris,
    bytes: bytes(arquivo),
  });
}

const g = lerJson(path.join(bruto, "garcom.json"));
const garcomArq = "pessoas/garcom.glb";
const trisG = await trisPorMalha(garcomArq);
const garcom = {
  arquivo: garcomArq,
  clipes: Object.fromEntries(Object.entries(g.clipes).map(([n, c]) => [n, c.segundos])),
  velocidade: r3(g.clipes.andando.velocidade_m_s),
  altura: r3(g.altura_repouso_m),
  triangulos: Object.values(trisG).reduce((a, b) => a + b, 0),
  bytes: bytes(garcomArq),
};

const decoracao = config.decoracao.map((d) => {
  const arquivo = `decoracao/${d.id}.glb`;
  return { id: d.id, arquivo, bytes: bytes(arquivo), licenca: d.licenca };
});

const manifesto = { versao: 1, unidade: "metro", frente: "+z", clientes, garcom, decoracao };
fs.writeFileSync(path.join(destino, "manifesto.json"), `${JSON.stringify(manifesto, null, 2)}\n`);
console.log("MANIFESTO", path.join(destino, "manifesto.json"));
