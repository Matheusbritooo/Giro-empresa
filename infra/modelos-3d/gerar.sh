#!/usr/bin/env bash
# Gera de novo os modelos 3D do salão (pessoas e decoração) em apps/web/public/modelos.
#
#   BPY_PYTHON=/caminho/do/venv/bin/python infra/modelos-3d/gerar.sh
#
# Requisitos (veja o README): Python 3.13 com bpy==5.2.2 (BPY_PYTHON), node 20+ e npm,
# acesso a raw.githubusercontent.com e ao registry do npm. Não roda na CI.
# Variáveis: TRABALHO (pasta de rascunho, padrão $TMPDIR/giro-modelos-3d),
#            DESTINO (padrão apps/web/public/modelos).
set -euo pipefail

aqui=$(cd "$(dirname "$0")" && pwd)
raiz=$(cd "$aqui/../.." && pwd)
TRABALHO=${TRABALHO:-${TMPDIR:-/tmp}/giro-modelos-3d}
DESTINO=${DESTINO:-$raiz/apps/web/public/modelos}

: "${BPY_PYTHON:?Diga onde está o Python com bpy 5.2.2: BPY_PYTHON=/caminho/venv/bin/python}"
"$BPY_PYTHON" -I -c "import bpy, sys; assert bpy.app.version[:2] == (5, 2), bpy.app.version_string; print('bpy', bpy.app.version_string, 'python', sys.version.split()[0])"
command -v node >/dev/null || { echo "Falta o node." >&2; exit 1; }

mkdir -p "$TRABALHO/dl" "$TRABALHO/bruto" "$TRABALHO/node"

echo "== 1. Ferramentas do node (versões fixas em node/package-lock.json)"
cp "$aqui/node/package.json" "$aqui/node/package-lock.json" "$TRABALHO/node/"
cp "$aqui"/node/*.mjs "$TRABALHO/node/"
(cd "$TRABALHO/node" && npm ci --no-audit --no-fund --loglevel=error)

echo "== 2. Downloads (lista fixa com sha256 em fontes.txt)"
while read -r soma destino url; do
  case "$soma" in ''|\#*) continue ;; esac
  arquivo="$TRABALHO/dl/$destino"
  mkdir -p "$(dirname "$arquivo")"
  if [ ! -s "$arquivo" ] || ! echo "$soma  $arquivo" | sha256sum -c --quiet - 2>/dev/null; then
    curl -sfL --retry 3 -o "$arquivo" "$url"
    echo "$soma  $arquivo" | sha256sum -c --quiet - || { echo "Arquivo mudou na origem: $url" >&2; exit 1; }
  fi
done < "$aqui/fontes.txt"

echo "== 3. Blender: clientes sentados (poses assadas) e garçom (esqueleto e clipes)"
"$BPY_PYTHON" -I "$aqui/blender/clientes.py" -- "$aqui/config.json" "$TRABALHO/dl" "$TRABALHO/bruto"
"$BPY_PYTHON" -I "$aqui/blender/garcom.py" -- "$aqui/config.json" "$TRABALHO/dl" "$TRABALHO/bruto/garcom.glb" "$TRABALHO/bruto/garcom.json"

echo "== 4. Otimizar (WebP 512, meshopt, simplificação) e copiar para $DESTINO"
mkdir -p "$DESTINO/pessoas" "$DESTINO/decoracao"
(
  cd "$TRABALHO/node"
  node etapas.mjs "$aqui/config.json" "$TRABALHO" "$DESTINO"
)
cp "$TRABALHO/dl/rocketbox/LICENSE.md" "$DESTINO/LICENSE-Rocketbox.md"

echo "== 5. Manifesto e conferência"
(
  cd "$TRABALHO/node"
  node manifesto.mjs "$aqui/config.json" "$TRABALHO/bruto" "$DESTINO"
  node validar.mjs "$aqui/config.json" "$DESTINO"
)
echo "Pronto: $DESTINO"
