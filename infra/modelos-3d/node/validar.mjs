// Confere os modelos prontos contra as regras do salão 3D. Sai com erro se algo falhar.
// Uso: node validar.mjs <config.json> <destino>
import fs from "node:fs";
import path from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

import { triangulos } from "./comum.mjs";

const [configPath, destino] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const lim = config.limites;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const erros = [];
const KB = 1024;
const exige = (ok, msg) => {
  if (!ok) erros.push(msg);
};

async function comum(rel, limiteBytes) {
  const caminho = path.join(destino, rel);
  const tam = fs.statSync(caminho).size;
  exige(tam <= limiteBytes, `${rel}: ${tam} bytes > ${limiteBytes}`);
  const doc = await io.read(caminho);
  const raiz = doc.getRoot();
  const ext = raiz.listExtensionsUsed().map((e) => e.extensionName);
  exige(ext.includes("EXT_meshopt_compression"), `${rel}: sem meshopt`);
  for (const t of raiz.listTextures()) {
    exige(t.getMimeType() === "image/webp", `${rel}: textura ${t.getMimeType()}`);
    const [w, h] = t.getSize() ?? [0, 0];
    exige(Math.max(w, h) <= config.textura_px, `${rel}: textura ${w}x${h}`);
  }
  return { tam, raiz };
}

let totalClientes = 0;
for (const c of config.clientes) {
  const rel = `pessoas/cliente-${c.id}.glb`;
  const { tam, raiz } = await comum(rel, lim.cliente_kb * KB);
  totalClientes += tam;
  const malhas = raiz.listMeshes().map((m) => m.getName()).sort();
  exige(JSON.stringify(malhas) === '["pose_0","pose_1","pose_2"]', `${rel}: malhas ${malhas}`);
  exige(raiz.listSkins().length === 0, `${rel}: tem esqueleto`);
  exige(raiz.listAnimations().length === 0, `${rel}: tem animação`);
  const mats = raiz.listMaterials().map((m) => m.getName());
  exige(mats.length <= 3 && mats.every((n) => ["corpo", "cabeca", "cabelo"].includes(n)), `${rel}: materiais ${mats}`);
  for (const m of raiz.listMaterials())
    exige(m.getAlphaMode() === (m.getName() === "cabelo" ? "MASK" : "OPAQUE"), `${rel}: ${m.getName()} ${m.getAlphaMode()}`);
  const linha = [];
  for (const m of raiz.listMeshes()) {
    const t = triangulos(m);
    linha.push(`${m.getName()} ${t}`);
    exige(t >= lim.triangulos_pose[0] && t <= lim.triangulos_pose[1], `${rel}: ${m.getName()} com ${t} triângulos`);
  }
  for (const no of raiz.listNodes()) {
    if (!no.getMesh()) continue;
    const ex = no.getExtras();
    for (const k of ["pelve", "cabeca_topo", "joelho_L", "joelho_R", "mao_L", "mao_R"])
      exige(Array.isArray(ex[k]) && ex[k].length === 3, `${rel}: ${no.getName()} sem extras.${k}`);
  }
  console.log(`ok? ${rel}: ${(tam / KB).toFixed(0)} KB, ${linha.join(", ")}`);
}
exige(totalClientes <= lim.clientes_total_kb * KB, `clientes somam ${totalClientes} bytes`);

{
  const rel = "pessoas/garcom.glb";
  const { tam, raiz } = await comum(rel, lim.garcom_kb * KB);
  exige(raiz.listSkins().length === 1, `${rel}: esqueletos ${raiz.listSkins().length}`);
  const clipes = raiz.listAnimations().map((a) => a.getName()).sort();
  exige(JSON.stringify(clipes) === '["andando","anotando","parado"]', `${rel}: clipes ${clipes}`);
  console.log(`ok? ${rel}: ${(tam / KB).toFixed(0)} KB, clipes ${clipes}`);
}

for (const d of config.decoracao) {
  const rel = `decoracao/${d.id}.glb`;
  const { tam, raiz } = await comum(rel, lim.decoracao_kb * KB);
  exige(raiz.listAnimations().length === 0 || !d.opcoes?.sem_animacao, `${rel}: animação sobrou`);
  console.log(`ok? ${rel}: ${(tam / KB).toFixed(0)} KB`);
}

let total = 0;
const somar = (p) => {
  for (const f of fs.readdirSync(p, { withFileTypes: true })) {
    const c = path.join(p, f.name);
    if (f.isDirectory()) somar(c);
    else total += fs.statSync(c).size;
  }
};
somar(destino);
exige(total <= lim.pasta_total_kb * KB, `pasta modelos com ${total} bytes`);
console.log(`total da pasta: ${(total / KB).toFixed(0)} KB; clientes: ${(totalClientes / KB).toFixed(0)} KB`);

if (erros.length) {
  console.error("FALHOU:\n  " + erros.join("\n  "));
  process.exit(1);
}
console.log("VALIDADO");
