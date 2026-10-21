---
name: mudanca-no-banco
description: Passo a passo para criar ou alterar tabelas e colunas do banco do GIRO com migração Alembic, garantindo isolamento por restaurante e que a migração funciona no Postgres e no SQLite. Use sempre que for mexer em giro/modelos.py, criar tabela, adicionar coluna, índice ou mudar tipo, ou quando pedirem "cria a tabela de...", "guarda também o...".
---

# Mudança no banco

Os modelos ficam em `services/backend/giro/modelos.py` e as migrações em `services/backend/migrations/versions/`. Todos os comandos rodam em `services/backend`.

## 1. Antes de mexer

- Toda tabela com dado de cliente tem `restaurante_id: Mapped[int] = mapped_column(ForeignKey("restaurantes.id"), index=True)`. Sem exceção.
- Datas usam `Mapped[datetime]`: o tipo `DataHora` (`giro/banco.py`) grava sempre em UTC com fuso. Nunca use `datetime.now()` sem fuso; use `giro.banco.agora()`.
- Estados e tipos são `String` no banco com um `StrEnum` no código, não `Enum` do banco (mudar enum no Postgres exige migração chata).
- Nada de coluna para imagem (LGPD). Se a ideia precisa guardar foto, pare e pergunte.
- Prefira não apagar coluna com dado: desative ou deixe de usar, e apague numa migração separada depois.

## 2. Altere o modelo

Edite `giro/modelos.py`. Se a tabela é nova, explique numa docstring curta para que ela serve.

## 3. Gere a migração

Precisa de um Postgres para gerar a migração no formato certo. Com Docker: `docker compose -f infra/docker-compose.yml up -d banco` (na raiz). Sem Docker, qualquer Postgres serve.

```bash
export GIRO_DATABASE_URL=postgresql+psycopg://giro:giro@localhost:5432/giro
uv run alembic upgrade head                                  # banco na versão atual
uv run alembic revision --autogenerate -m "o que mudou, em português"
```

Abra o arquivo gerado em `migrations/versions/` e confira:
- só tem o que você mudou (o autogenerate às vezes inventa mudanças de tipo);
- `downgrade()` desfaz exatamente o `upgrade()`;
- coluna nova `NOT NULL` em tabela que já tem linhas precisa de `server_default` ou de duas etapas (cria nula, preenche, depois trava).

Formate: `uv run ruff format migrations && uv run ruff check --fix migrations`.

## 4. Prove que funciona

```bash
uv run alembic upgrade head && uv run alembic check   # "No new upgrade operations detected"
uv run alembic downgrade -1 && uv run alembic upgrade head
GIRO_DATABASE_URL=sqlite:///./teste-migracao.db uv run alembic upgrade head && rm teste-migracao.db
```

## 5. Testes

- Rode `uv run pytest -q` (SQLite) e `GIRO_TESTE_DATABASE_URL=$GIRO_DATABASE_URL uv run pytest -q` (Postgres).
- Se criou rota que lê a tabela nova, adicione teste de isolamento: um restaurante não pode ver nem alterar a linha do outro.

## 6. Ao terminar

Diga qual migração foi criada, o que ela faz, e confirme os resultados de upgrade, check, downgrade e testes. A CI roda `alembic upgrade head` e `alembic check` contra Postgres em todo PR.
