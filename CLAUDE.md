# GIRO

Sistema da GIRO Tecnologia e Soluções Ltda (TCM do curso Técnico em Administração: Almir, Gabriel, Ingrid, Matheus e Vitória). A GIRO liga na câmera de segurança que o restaurante já tem, analisa uma foto a cada 10 segundos e transforma o salão em informação: mapa de mesas ao vivo, alerta de cliente sem atendimento, alerta de mesa vaga e indicadores de giro.

Cliente: restaurante de bairro com 6 a 20 mesas, na região oeste da Grande São Paulo. A persona é o Marcos, 43 anos, dono da Cantina do Marcos em Cotia: domina a cozinha, não a gestão, e não quer tecnologia, quer saber por que a mesa 7 ficou vinte minutos suja numa sexta lotada.

## Regras do negócio que o código segue

| Regra | Valor | Onde está |
|---|---|---|
| Foto da câmera | 1 a cada 10 s, nunca vídeo contínuo | `giro/simulador/cenario.py` (`INTERVALO`) |
| Ocupação confirmada | 20 s vendo gente sentada | `giro/dominio/mesa.py` (`Regras`) |
| Saída confirmada | 1 min com a mesa vazia | `giro/dominio/mesa.py` |
| Alerta de cliente sem atendimento | 5 min (o dono pode mudar de 1 a 30) | `Restaurante.alerta_atendimento_seg` |
| Sentada na mesa | caixa da pessoa até 2,2x mais alta que larga, com o meio da base dentro do desenho da mesa | `giro/visao/leitura.py` (`Ajustes`) |
| Em pé junto à mesa (garçom) | caixa mais alta que isso, até 5% da foto de distância do desenho | `giro/visao/leitura.py` |
| Detector de pessoas | YOLOX (Apache 2.0) em ONNX, só CPU: ~220 ms por foto no `yolox_s` | `giro/visao/detector.py`, `modelo.py` |
| Assinatura e ativação | R$ 299/mês e R$ 290 (Fase 4) | ainda não está no código |
| Custo de nuvem orçado | R$ 100 por cliente/mês (visão R$ 65) | anexo A.1 do TCM |

Estados da mesa: `livre` → `aguardando` → `ocupada` → `para_limpar` → `livre`. Quem vai embora sem ser atendido volta direto a `livre` e conta como desistência. O diagrama está no topo de `giro/dominio/mesa.py`.

## Privacidade (LGPD): inegociável

- Imagem de câmera nunca é gravada (disco, banco, log, fila ou serviço externo). Analisa em memória e descarta. Fica só evento em texto.
- A prévia da câmera, usada para desenhar as mesas, tem as pessoas pixeladas e vive só na memória do serviço de visão por 3 minutos.
- Vídeo de restaurante para calibrar a visão fica fora do repositório e só com autorização do dono (skill `validar-visao`).
- Nada de reconhecimento facial ou de identificar quem é a pessoa. O sistema só conta pessoas por mesa.
- Toda tabela de cliente tem `restaurante_id` e toda rota filtra por ele. Um restaurante nunca vê o outro.
- A trava `scripts/verificar-commit.sh` bloqueia `.env`, chaves e imagens no repositório. Rode a skill `checagem-lgpd` antes de juntar mudanças em câmera, banco, API ou logs.

## Estrutura

```
services/backend/   Python 3.12+, FastAPI, SQLAlchemy, Alembic (uv)
  giro/dominio/     regras puras (máquina de estados da mesa), sem banco nem API
  giro/servicos/    liga o domínio ao banco, ao painel ao vivo e ao push
  giro/api/         rotas; dependências de login e restaurante em deps.py
  giro/simulador/   faz o papel da câmera; cenários em cenarios/*.yaml
  giro/visao/       serviço de visão: detector, regra de mesa, prévia pixelada, avaliação
  giro/conector.py  pega a imagem do DVR (RTSP ou foto HTTP) e manda para a visão
  migrations/       Alembic
apps/web/           Next.js 16 (App Router, Cache Components), Tailwind 4, PWA (pnpm)
infra/              docker-compose e Dockerfiles; infra/render: demonstração online (render.yaml na raiz)
scripts/            trava de commit
.claude/            hooks, skills e agentes deste projeto
```

Caminho de uma foto: DVR ► conector ► `POST /visao/quadros` (serviço de visão, porta 8001) ► detecta e conta por mesa ► `POST /api/ingest/observacoes` (só números) ► máquina de estados ► painel. O simulador manda direto para `/api/ingest/observacoes`, no mesmo formato. A API busca a prévia na visão por `/interno/*`, protegido por `GIRO_VISAO_SEGREDO`; essas rotas nunca ficam expostas.

## Comandos

Backend (em `services/backend`):
```bash
uv sync --all-extras                            # dependências, inclusive visão e conector
uv run alembic upgrade head && uv run python -m giro.seed   # banco + Cantina do Marcos
uv run uvicorn --factory giro.api.app:criar_app --reload    # API em :8000 (docs em /api/docs)
uv run pytest -q                                # testes (SQLite)
uv run ruff check giro tests migrations && uv run ruff format giro tests migrations
uv run python -m giro.simulador verificar       # cenários do salão
uv run python -m giro.visao.modelo              # baixa o detector (conferindo o hash)
uv run python -m giro.conector --help           # conector do DVR
uv run python -m giro.visao.avaliar --help      # medir a visão com vídeo real
```

`make dev` na raiz sobe API, visão e painel já ligados entre si.

Painel (em `apps/web`):
```bash
pnpm install && pnpm dev                        # painel em :3000, usa a API em :8000
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
pnpm e2e                                        # sobe API e painel próprios (8100/3100)
```

No ambiente da nuvem do Claude o Chromium já existe: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`.

Login de demonstração (senha `giro1234`): `admin@giro.demo`, `marcos@cantina.demo` (dono), `gerente@cantina.demo`, `equipe@cantina.demo`.

## Antes de dizer que terminou

1. Backend: `ruff check`, `ruff format --check`, `pytest` e `simulador verificar` passando.
2. Painel: `lint`, `typecheck`, `format:check`, `test` e, se mexeu em tela ou fluxo, `e2e`.
3. Mudou regra da mesa: atualize ou crie cenário (skill `simular-salao`). Mudou a visão: `tests/test_visao.py` e, com vídeo, a skill `validar-visao`.
4. Mudou banco: migração Alembic (skill `mudanca-no-banco`).
5. Mexeu em dado de cliente: skill `checagem-lgpd`.

## Convenções

- Código, nomes, comentários, mensagens de commit e textos de tela em português.
- Texto de tela para o Marcos entender em 5 minutos: verbos simples ("Liberar mesa", "Vou atender"), frase curta, sem termo técnico. O mesmo nome de ação do botão até a confirmação ("Liberar mesa" → "Mesa 7 liberada.").
- Estado da mesa sempre por cor + padrão + palavra, nunca só cor. Cores e fontes estão em `apps/web/src/app/globals.css`; não invente cor fora dos tokens.
- Next.js 16 tem mudanças grandes: leia `apps/web/node_modules/next/dist/docs/` antes de usar API que você não viu neste código (veja `apps/web/AGENTS.md`).
- Dados no painel: `useDados` (`src/lib/dados.ts`) para telas comuns e `useSalaoAoVivo` (`src/lib/ao-vivo.ts`) para o salão. Não chame setState direto dentro de useEffect (o lint barra).
- Dependência nova só com motivo; explique no commit.

## Skills e agentes do projeto

- `simular-salao`: roda e cria cenários, prepara demonstração ao vivo.
- `checagem-lgpd`: checklist de privacidade e isolamento antes de juntar.
- `mudanca-no-banco`: migração Alembic segura.
- `validar-visao`: medir e calibrar a visão com vídeo real de salão.
- Agente `guardiao-lgpd`: revisão de privacidade, só leitura.
- Agente `testador-salao`: roda a bateria inteira e relata, não corrige.
- Agente `especialista-visao`: calibra detector, desenho das mesas e regra de sentado/em pé.

## Glossário

- **Giro**: quantas vezes a mesma mesa é ocupada numa noite. Também é o nome do capital de giro da empresa.
- **Ocupação**: uma visita à mesa, de sentar até liberar (tabela `ocupacoes`). Base de todos os indicadores.
- **Mesa parada**: tempo entre os clientes saírem e a mesa ser liberada. É o que mais corrói o giro.
- **Desistência**: cliente que sentou e foi embora sem ser atendido (`ocupacoes.sem_atendimento`).
