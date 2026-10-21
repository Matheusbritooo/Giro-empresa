## O que muda

<!-- Em uma ou duas frases, o que este PR faz. -->

## Por quê

<!-- Qual problema do restaurante ou da GIRO isso resolve. Cite a fase do projeto ou a missão do TCM, se for o caso. -->

## Como testei

- [ ] Backend: `uv run ruff check` e `uv run pytest` passando
- [ ] Cenários do salão: `uv run python -m giro.simulador verificar`
- [ ] Painel: `pnpm lint`, `pnpm typecheck`, `pnpm test`
- [ ] Ponta a ponta (se mexeu em tela ou fluxo): `pnpm e2e`
- [ ] Testei no celular (tela de 390 px de largura)

## Privacidade

- [ ] Nenhuma imagem de câmera é gravada em lugar nenhum
- [ ] Toda rota ou tabela nova respeita o restaurante do usuário
- [ ] Rodei a skill `checagem-lgpd` (obrigatório se mexeu em câmera, banco, API ou logs)

## Prints

<!-- Se mudou alguma tela, cole o antes e o depois. -->
