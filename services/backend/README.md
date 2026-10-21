# Backend do GIRO

API (FastAPI), regras da mesa, alertas e simulador de salão. Visão geral e como rodar tudo junto: veja o `README.md` e o `CLAUDE.md` na raiz.

```bash
uv sync
uv run alembic upgrade head && uv run python -m giro.seed
uv run uvicorn --factory giro.api.app:criar_app --reload   # documentação em http://localhost:8000/api/docs
uv run pytest -q
uv run python -m giro.simulador --help
```

Configuração por variáveis `GIRO_*` (lista completa em `giro/config.py`, exemplo em `.env.example`).
