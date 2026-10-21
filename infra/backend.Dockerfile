# API do GIRO (FastAPI). Contexto do build: services/backend
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv
ENV UV_NO_CACHE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev

# Roda sem ser root. Só lê os arquivos, então não precisa ser dono deles.
RUN useradd --system --uid 1001 giro
USER giro
EXPOSE 8000

# Aplica as migrações e sobe a API. Atrás do Caddy, que cuida do HTTPS.
CMD ["sh", "-c", "/app/.venv/bin/alembic upgrade head && exec /app/.venv/bin/uvicorn --factory giro.api.app:criar_app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
