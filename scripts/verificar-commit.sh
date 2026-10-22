#!/bin/bash
# Trava de LGPD e segredos. Roda antes de cada commit (.githooks/pre-commit) e na CI.
#   scripts/verificar-commit.sh          confere o que está no stage
#   scripts/verificar-commit.sh --todos  confere todos os arquivos do repositório
#
# Bloqueia:
#   - arquivos .env com segredos (só .env.example e .env.development podem entrar);
#   - imagens e vídeos fora das pastas de ícones e telas do sistema: foto de salão de
#     cliente nunca entra no repositório;
#   - modelo 3D (.glb/.gltf, que pode levar imagem dentro) fora de apps/web/public/modelos/
#     ou sem estar no manifesto.json, que é gerado por infra/modelos-3d;
#   - chaves privadas coladas no código;
#   - arquivos acima de 5 MB.
set -uo pipefail

if [ "${1:-}" = "--todos" ]; then
  arquivos=$(git ls-files)
else
  arquivos=$(git diff --cached --name-only --diff-filter=ACMR)
fi

problemas=()
while IFS= read -r arquivo; do
  [ -z "$arquivo" ] && continue
  nome=$(basename "$arquivo")

  case "$nome" in
    .env.example|.env.development) ;;
    .env|.env.*) problemas+=("$arquivo: arquivo de ambiente pode ter senha. Use .env.example.") ;;
  esac

  case "${nome,,}" in
    *.jpg|*.jpeg|*.png|*.webp|*.gif|*.bmp|*.tif|*.tiff|*.heic|*.avif|*.jxl|*.svgz|*.ktx2|*.basis|*.exr|*.hdr|*.mp4|*.avi|*.mkv|*.mov|*.h264|*.h265|*.dav)
      case "$arquivo" in
        apps/web/public/icone*|apps/web/src/app/icon*|apps/web/src/app/apple-icon*|docs/telas/*) ;;
        *) problemas+=("$arquivo: imagem ou vídeo fora de apps/web/public/icone* ou docs/telas/. Foto de câmera de cliente nunca entra no repositório (LGPD).") ;;
      esac
      ;;
    *.glb|*.gltf)
      case "$arquivo" in
        apps/web/public/modelos/*)
          if ! grep -qF "\"${arquivo#apps/web/public/modelos/}\"" apps/web/public/modelos/manifesto.json 2>/dev/null; then
            problemas+=("$arquivo: modelo 3D fora do manifesto.json. Gere com infra/modelos-3d/gerar.sh.")
          fi
          ;;
        *) problemas+=("$arquivo: modelo 3D fora de apps/web/public/modelos/. Pode levar imagem dentro (LGPD).") ;;
      esac
      ;;
  esac

  if [ -f "$arquivo" ]; then
    if grep -qE -- "-----BEGIN ([A-Z]+ )?PRIVATE KEY-----" "$arquivo" 2>/dev/null; then
      problemas+=("$arquivo: contém chave privada.")
    fi
    tamanho=$(wc -c < "$arquivo")
    if [ "$tamanho" -gt 5242880 ]; then
      problemas+=("$arquivo: tem mais de 5 MB.")
    fi
  fi
done <<< "$arquivos"

if [ ${#problemas[@]} -gt 0 ]; then
  echo "Commit bloqueado pela trava de LGPD e segredos:" >&2
  printf '  - %s\n' "${problemas[@]}" >&2
  exit 1
fi
