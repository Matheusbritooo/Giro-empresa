#!/usr/bin/env bash
# Sobe a API com banco limpo e os dados de demonstração, para o teste de ponta a ponta do painel.
set -euo pipefail
cd "$(dirname "$0")/.."
export GIRO_DATABASE_URL="${GIRO_DATABASE_URL:-sqlite:///./giro-e2e.db}"
rm -f giro-e2e.db
uv run alembic upgrade head
uv run python -m giro.seed
exec uv run uvicorn --factory giro.api.app:criar_app --port "${PORTA_API:-8100}"
