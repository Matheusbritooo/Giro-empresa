# GIRO

**A câmera que já está no teto agora conta o tempo das suas mesas.**

A GIRO liga na câmera de segurança que o restaurante já tem, analisa uma foto a cada 10 segundos e mostra o salão ao vivo: quais mesas estão livres, quais estão esperando atendimento, quais estão ocupadas e quais vagaram e precisam ser limpas. Se um cliente senta e passa 5 minutos sem ninguém ir até a mesa, o gerente recebe um alerta no celular.

Projeto do TCM *O Segredo do Meu Negócio* (Técnico em Administração), da equipe Almir, Gabriel, Ingrid, Matheus e Vitória.

![Salão ao vivo no computador](docs/telas/salao-computador.png)

<p>
  <img src="docs/telas/salao-celular.png" alt="Salão no celular" width="260">
  <img src="docs/telas/salao-celular-escuro.png" alt="Salão no celular, tema escuro" width="260">
</p>

## O que já funciona

**Fase 0 (fundação) e Fase 1 (salão no simulador) prontas.**

- Mapa de mesas ao vivo, com cronômetro em cada mesa e as cadeiras ocupadas desenhadas em volta.
- Alerta de cliente sem atendimento (5 min, ajustável pelo dono) e alerta de mesa vaga, com som no painel e notificação no celular.
- Botões "Vou atender" e "Liberar mesa": quando um garçom toca, todos os aparelhos atualizam na hora.
- Registro de cada visita à mesa (sentou, foi atendida, saiu, foi liberada), que é a base dos indicadores da Fase 3.
- Perfis de acesso: equipe do salão, gerente, dono e equipe GIRO (que ativa clientes novos).
- Cadastro de mesas na planta, equipe, câmeras e ajustes do restaurante.
- Simulador de salão que faz o papel da câmera, com cenários prontos e noite aleatória para demonstração.
- Funciona como aplicativo no celular (PWA), sem loja de apps, nos temas claro e escuro.

## Rodar no seu computador

Precisa de [uv](https://docs.astral.sh/uv/) (Python) e [pnpm](https://pnpm.io/) (Node 22).

```bash
make instalar   # dependências e trava de commit
make dados      # cria o banco (SQLite) e a Cantina do Marcos com 14 mesas
make dev        # API em http://localhost:8000 e painel em http://localhost:3000
```

Em outro terminal, ligue o simulador:

```bash
make demo
```

Entre em http://localhost:3000 com `gerente@cantina.demo` e senha `giro1234`. Outros acessos de demonstração: `marcos@cantina.demo` (dono), `equipe@cantina.demo` (garçom) e `admin@giro.demo` (equipe GIRO).

Prefere Postgres, como em produção? `make banco` sobe um no Docker. Depois, antes do `make dados`, rode `export GIRO_DATABASE_URL=postgresql+psycopg://giro:giro@localhost:5432/giro`.

## Roteiro de demonstração (banca ou cliente)

1. Abra o painel no computador como gerente e no celular como garçom (`equipe@cantina.demo`).
2. Ligue um cenário que já começa no meio, para o primeiro alerta aparecer em 30 segundos:
   ```bash
   cd services/backend
   uv run python -m giro.simulador ao-vivo --cenario sexta-lotada --inicio-em 4:30
   ```
3. Mostre o alerta da mesa 4 sem atendimento, toque em "Vou atender" no celular e veja o computador atualizar.
4. Quando a mesa 1 vagar, toque em "Liberar mesa". Toque na mesa 7 para mostrar a linha do tempo: quando sentaram, quanto esperaram e há quanto tempo está parada.

Os cenários disponíveis aparecem com `uv run python -m giro.simulador listar`.

## Como funciona

```
Câmera / DVR ──1 foto a cada 10s──► visão computacional (Fase 2) ─┐
Simulador (hoje) ─────────────────────────────────────────────────┤
                                                                  ▼
                                         POST /api/ingest/observacoes
                                         (só números: sentados e em pé por mesa)
                                                                  │
                                              máquina de estados da mesa
                                                                  │
                         ┌────────────────────────┬───────────────┴────────┐
                         ▼                        ▼                        ▼
                  banco (histórico)     painel ao vivo (WebSocket)   celular (Web Push)
```

A foto nunca chega à API: ela é analisada e descartada antes. O que fica gravado são eventos em texto, como "mesa 4 ocupada às 20h41" (LGPD, seção 1.9 do TCM).

## Estrutura

```
services/backend/   API em Python (FastAPI, SQLAlchemy, Alembic) e simulador
apps/web/           Painel em Next.js 16 e Tailwind, instalável no celular
infra/              Docker, Postgres e Caddy para colocar no ar
docs/               decisões técnicas e telas
scripts/            trava de commit (LGPD e segredos)
.claude/            hooks, skills e agentes do Claude Code para este projeto
```

## Testes

```bash
make testes   # lint, testes do backend, cenários do salão e testes do painel
make e2e      # navegador de verdade, no celular e no computador
```

A CI do GitHub roda tudo isso em cada PR, inclusive contra Postgres, e confere se as migrações do banco batem com o código.

## Colocar no ar

Num servidor com Docker e um domínio apontando para ele:

```bash
cp infra/.env.example infra/.env   # preencha domínio, senha do banco e segredos
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile completo up -d --build
```

O Caddy emite o certificado HTTPS sozinho. Um servidor de 4 núcleos atende dezenas de restaurantes (veja `docs/decisoes.md`).

## Trabalhando com o Claude Code

O repositório já vem preparado para o grupo usar o Claude Code:

- `CLAUDE.md` traz as regras do negócio, de LGPD e os comandos. Quem abrir o Claude Code aqui já começa sabendo.
- Skills: `simular-salao`, `checagem-lgpd` e `mudanca-no-banco`.
- Agentes: `guardiao-lgpd` (revisa privacidade, só lê) e `testador-salao` (roda tudo e relata).
- Hooks: formatam o código a cada edição e preparam as sessões na nuvem.
- No GitHub, escreva `@claude` numa issue ou PR para pedir uma tarefa ou revisão (precisa instalar o app do Claude no repositório e configurar o segredo `CLAUDE_CODE_OAUTH_TOKEN`; o comando `/install-github-app` do Claude Code faz isso).

## Próximas fases

| Fase | Entrega |
|---|---|
| 2. Visão computacional | Receber fotos do DVR, detectar pessoas, desenhar as mesas sobre a imagem, modo demonstração do vendedor |
| 3. Inteligência | Painel de desempenho (giro, tempo de atendimento, mesa parada, horário de pico), previsão da próxima mesa a vagar, relatório semanal "quanto a GIRO te devolveu" |
| 4. Gestão GIRO | Leads com as perguntas de qualificação, assinatura e cobrança (Asaas), painel financeiro |
| 5. Site | Página de vendas e calculadora de retorno |
