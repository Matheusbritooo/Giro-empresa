#!/bin/bash
# Prepara as sessões do Claude Code na nuvem: dependências do backend e do painel,
# trava de commit (LGPD) e o Chromium para os testes de ponta a ponta.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Backend (Python): cria .venv com tudo do uv.lock, inclusive pytest e ruff.
(cd services/backend && uv sync)

# Painel (Next.js): pnpm install aproveita o cache do container entre sessões.
(cd apps/web && CI=true pnpm install --config.confirmModulesPurge=false)

# Trava de commit: bloqueia .env, chaves e imagens de câmera (scripts/verificar-commit.sh).
git config core.hooksPath .githooks

# O ambiente da nuvem já traz o Chromium; o Playwright usa ele em vez de baixar outro.
if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi
