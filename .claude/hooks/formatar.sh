#!/bin/bash
# Depois de cada edição do Claude: formata o arquivo no padrão do projeto.
# Nunca bloqueia a edição; se a ferramenta não estiver instalada, só segue.
set -uo pipefail

arquivo=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
[ -z "$arquivo" ] || [ ! -f "$arquivo" ] && exit 0

raiz="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
case "$arquivo" in
  "$raiz"/services/backend/*.py)
    (cd "$raiz/services/backend" && uv run --quiet ruff format --quiet "$arquivo" \
      && uv run --quiet ruff check --quiet --select I --fix "$arquivo") >/dev/null 2>&1
    ;;
  "$raiz"/apps/web/*.ts|"$raiz"/apps/web/*.tsx|"$raiz"/apps/web/*.js|"$raiz"/apps/web/*.mts|"$raiz"/apps/web/*.json|"$raiz"/apps/web/*.css)
    (cd "$raiz/apps/web" && ./node_modules/.bin/biome format --write --no-errors-on-unmatched "$arquivo") >/dev/null 2>&1
    ;;
esac
exit 0
