# Atalhos do dia a dia. Rode `make` para ver a lista.
.DEFAULT_GOAL := ajuda
BACKEND := services/backend
WEB := apps/web

.PHONY: ajuda instalar banco dados dev dev-api dev-web demo testes lint e2e

ajuda: ## Mostra esta lista
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-10s %s\n", $$1, $$2}'

instalar: ## Instala tudo e liga a trava de commit (rode uma vez por clone)
	cd $(BACKEND) && uv sync
	cd $(WEB) && pnpm install
	git config core.hooksPath .githooks

banco: ## Sobe o Postgres local no Docker
	docker compose -f infra/docker-compose.yml up -d banco

dados: ## Cria as tabelas e a Cantina do Marcos (dados de demonstração)
	cd $(BACKEND) && uv run alembic upgrade head && uv run python -m giro.seed

dev: ## Sobe API (:8000) e painel (:3000) juntos
	$(MAKE) -j2 dev-api dev-web

dev-api:
	cd $(BACKEND) && uv run uvicorn --factory giro.api.app:criar_app --reload --port 8000

dev-web:
	cd $(WEB) && pnpm dev

demo: ## Liga o simulador: noite aleatória nas 14 mesas, em ritmo de demonstração
	cd $(BACKEND) && uv run python -m giro.simulador ao-vivo --aleatorio --ritmo demo --mesas 1-14 --repetir

testes: lint ## Roda todos os testes rápidos (backend, cenários e painel)
	cd $(BACKEND) && uv run pytest -q && uv run python -m giro.simulador verificar
	cd $(WEB) && pnpm typecheck && pnpm test

lint: ## Confere estilo e formatação
	cd $(BACKEND) && uv run ruff check giro tests migrations && uv run ruff format --check giro tests migrations
	cd $(WEB) && pnpm lint && pnpm format:check

e2e: ## Teste de ponta a ponta no navegador (sobe API e painel próprios)
	cd $(WEB) && pnpm e2e
