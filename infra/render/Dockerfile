# Demonstração do GIRO num serviço só, para o plano grátis do Render: painel, API e
# simulador de salão atrás de um Caddy. O HTTPS fica com o Render.
# Contexto do build: raiz do repositório. Servidor de verdade: infra/docker-compose.yml.
# A visão (câmera real) fica de fora: não cabe nos 512 MB junto com o resto.

FROM node:22-slim AS web
RUN corepack enable
WORKDIR /web
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web/ ./
# Vazio = a API está no mesmo endereço do painel (o Caddy manda /api para ela).
ENV NEXT_PUBLIC_API_URL="" NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM python:3.13-slim AS api
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv
ENV UV_NO_CACHE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY services/backend/pyproject.toml services/backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/backend/ ./
RUN uv sync --frozen --no-dev

FROM python:3.13-slim
COPY --from=caddy:2 /usr/bin/caddy /usr/local/bin/caddy
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=api /app /app
COPY --from=web /web/.next/standalone /web
COPY --from=web /web/.next/static /web/.next/static
COPY --from=web /web/public /web/public
COPY infra/render/Caddyfile /etc/caddy/Caddyfile
COPY infra/render/iniciar.sh /usr/local/bin/iniciar-giro

ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp

# Roda sem ser root. Só lê os arquivos, então não precisa ser dono deles.
RUN useradd --system --uid 1001 giro
USER giro
WORKDIR /app
EXPOSE 10000
CMD ["iniciar-giro"]
