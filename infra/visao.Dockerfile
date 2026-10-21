# Serviço de visão do GIRO (detecção de pessoas em CPU). Contexto do build: services/backend
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv
ENV UV_NO_CACHE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv PYTHONUNBUFFERED=1 \
    GIRO_VISAO_PASTA=/app/modelos

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra visao --no-install-project
COPY . .
RUN uv sync --frozen --no-dev --extra visao

# O modelo entra na imagem (hash conferido), para o servidor não depender do GitHub ao subir.
ARG MODELO=yolox_s
ENV GIRO_VISAO_MODELO=$MODELO
RUN /app/.venv/bin/python -m giro.visao.modelo "$MODELO"

# Roda sem ser root. Só lê os arquivos, então não precisa ser dono deles.
RUN useradd --system --uid 1001 giro
USER giro
EXPOSE 8001

CMD ["/app/.venv/bin/uvicorn", "--factory", "giro.visao.servico:criar_app", "--host", "0.0.0.0", "--port", "8001"]
