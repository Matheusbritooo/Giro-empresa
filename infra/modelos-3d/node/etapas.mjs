// Roda o otimizar.mjs para cada modelo do config.json.
// Uso: node etapas.mjs <config.json> <pasta_trabalho> <destino>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [configPath, trabalho, destino] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const otimizar = (entrada, saida, opcoes) => {
  execFileSync("node", ["otimizar.mjs", entrada, saida, JSON.stringify(opcoes)], { stdio: "inherit" });
};

for (const c of config.clientes)
  otimizar(path.join(trabalho, "bruto", `${c.id}.glb`), path.join(destino, "pessoas", `cliente-${c.id}.glb`), {
    tipo: "pessoa",
    tex: config.textura_px,
    triangulos: config.triangulos_por_pose,
  });

otimizar(path.join(trabalho, "bruto", "garcom.glb"), path.join(destino, "pessoas", "garcom.glb"), {
  tipo: "pessoa",
  tex: config.textura_px,
});

for (const d of config.decoracao)
  otimizar(
    path.join(trabalho, "dl", "khronos", d.fonte, `${d.fonte}.glb`),
    path.join(destino, "decoracao", `${d.id}.glb`),
    { tipo: "decoracao", tex: config.textura_px, ...d.opcoes },
  );
