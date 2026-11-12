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
| Noite | das 6h às 6h do dia seguinte, horário de São Paulo (UTC-3) | `giro/dominio/indicadores.py`, `apps/web/src/lib/resultados.ts` |
| Dinheiro que ficou na mesa | quem foi embora × ticket médio + mesa parada além de 3 min nas horas com 75% das mesas ocupadas | `giro/dominio/indicadores.py` |
| Ticket médio e horário do salão | R$ 85 por pessoa, 18:00 às 23:30 (o dono muda em Ajustes) | `Restaurante.ticket_medio_centavos`, `abre_as`, `fecha_as` |
| "E se?" | limpeza mais rápida e garçons a mais ou a menos, sobre as últimas 4 semanas | `giro/dominio/cenarios.py` |
| Copiloto | sem chave: respostas prontas; com `GIRO_ANTHROPIC_API_KEY`: IA, só com números somados; 60 perguntas/hora por restaurante | `giro/servicos/copiloto.py` |
| Pedido na mesa | o primeiro item lançado conta como atendimento (tira o alerta); em mesa livre ou suja, abre a visita já atendida | `MaquinaMesa.registrar_pedido` em `giro/dominio/mesa.py` |
| Gestão do cardápio | item nunca é apagado (`ativo=False`); nome e preço copiados no pedido; cancelar só gerente e dono, com motivo da lista; custo só o dono vê e muda; "acabou" qualquer um da equipe marca | `giro/api/rotas/cardapio.py`, `pedidos.py` |
| Ticket real | gasto médio por pessoa das visitas com pedido e gente contada; vale com 5 ou mais visitas, senão o de Ajustes | `giro/servicos/resultados.py` (`MINIMO_VISITAS_TICKET_REAL`) |
| Matriz de lucro | Kasavana e Smith dentro de cada categoria: vende muito = fatia acima de 70% da fatia igual; lucra bem = lucro por unidade (preço pago menos custo) acima da média ponderada; só o dono vê, nem o Copiloto do gerente recebe | `giro/dominio/cardapio.py` |
| Quem pede também pede | acompanhamento = bebida ou item de outra categoria com menos de 60% do preço do prato; ordem pelo quanto sai mais com o prato do que no geral, mínimo 10% das mesas | `giro/dominio/cardapio.py`, `giro/servicos/cardapio.py` |
| Pediu a conta | a mesa segue ocupada e mostra quando deve vagar: mediana de (saiu − conta) das últimas 4 semanas, 10 min com menos de 5 contas | `ocupacoes.conta_pedida_em`, `previsao_de_vaga` |
| Estoque | quantidade na unidade base (g, ml, un), preço por kg, L ou un; cada prato lançado baixa pela ficha; cancelado antes do "Pronto" volta, depois vira perda ("Prato cancelado"); a contagem substitui a conta; tudo vira linha no livro (`movimentos_estoque`), nada se apaga | `giro/dominio/estoque.py`, `giro/servicos/estoque.py` |
| Quem mexe no estoque | equipe vê sem valores e registra perda; gerente cadastra, lança compra com o valor da nota e conta; custo dos pratos e "outros" da ficha só o dono; "acabou" nunca é marcado sozinho (o estoque zerado só sugere) | `giro/api/rotas/estoque.py` |
| Lista de compras | cada prato prevê pela mediana das últimas 4 noites iguais que já terminaram (hoje conta só o que falta vender); a compra cobre do dia dela até a véspera da seguinte; comprar = precisa × (1 + folga) − o que sobra no dia da compra, arredondado na embalagem; vai faltar = acaba antes de a compra chegar; dias de compra (padrão terça e sexta) e folga (15%) em Ajustes; para a IA vão só quantidades | `giro/dominio/compras.py`, `giro/servicos/compras.py` |
| Perdas | só o dono; num período (7 dias ou 4 semanas): pela ficha = vendas − estornos; escapou = perda registrada + sem registro (a contagem achando menos: a diferença vale para os dias desde a contagem anterior, e o período leva o que sumiu nos seus 7 ou 28 dias até a última contagem feita nele); ingrediente fora de uso continua na conta; valores pelo preço médio de hoje; curva ABC pelo que saiu em 4 semanas (A até 80%, B até 95%); curva A sem contagem há mais de 7 noites vira lembrete; compra com nota 10% mais cara que a anterior avisa o dono no celular; "tem agora" do cadastro é o tipo `inicial` no livro, não sobra; para a IA vão só quantidades | `giro/dominio/perdas.py`, `giro/servicos/perdas.py` |
| Pedido sem internet | sem rede, o pedido lançado fica na fila do aparelho e é reenviado com a mesma chave: o servidor não lança nem baixa o estoque duas vezes, e não confere de novo o que acabou (já tinha entrado); sobe sozinho até 10 min guardado, depois o garçom confirma; recusado pelo servidor (4xx, fora 401, 408 e 429) volta para o garçom montar de novo; só a conta que lançou envia | `apps/web/src/lib/fila-pedidos.ts`, `components/faixa-conexao.tsx`, `ItemPedido.chave_lancamento` |
| Tela "Hoje" | só gestão (entrada do dono); pendências do mais urgente ao menos, cada uma com a tela onde se resolve: cozinha esperando há mais de 20 min, estoque zerado com prato à venda, o que acaba antes da compra, dia de compra, hora de contar e o que está como "acabou"; preço que subiu e perdas em reais só para o dono; alerta aberto e câmera sem sinal vêm do canal ao vivo | `giro/servicos/hoje.py`, `apps/web/src/lib/hoje.ts` |
| Custo pela ficha | prato com ficha tem `custo_centavos` calculado pela ficha (ingredientes pelo custo médio ponderado das compras + "outros") e não se digita; a matriz de lucro usa esse custo | `atualizar_custo_dos_pratos` |
| Assinatura e ativação | R$ 299/mês e R$ 290 (Fase 4) | ainda não está no código |
| Custo de nuvem orçado | R$ 100 por cliente/mês (visão R$ 65) | anexo A.1 do TCM |

Estados da mesa: `livre` → `aguardando` → `ocupada` → `para_limpar` → `livre`. Quem vai embora sem ser atendido volta direto a `livre` e conta como desistência. O diagrama está no topo de `giro/dominio/mesa.py`.

O GIRO não emite nota fiscal nem recebe pagamento: o caixa continua no sistema do restaurante. O pedido é da mesa (preso à visita em `ocupacoes`), nunca da pessoa.

## Privacidade (LGPD): inegociável

- Imagem de câmera nunca é gravada (disco, banco, log, fila ou serviço externo). Analisa em memória e descarta. Fica só evento em texto.
- A prévia da câmera, usada para desenhar as mesas, tem as pessoas pixeladas e vive só na memória do serviço de visão por 3 minutos.
- Vídeo de restaurante para calibrar a visão fica fora do repositório e só com autorização do dono (skill `validar-visao`).
- Nada de reconhecimento facial ou de identificar quem é a pessoa. O sistema só conta pessoas por mesa.
- Para a IA do Copiloto vão só números somados e a pergunta do dono (lista exata no README). Nunca imagem, nome de pessoa, e-mail ou horário de uma visita isolada.
- Toda tabela de cliente tem `restaurante_id` e toda rota filtra por ele. Um restaurante nunca vê o outro.
- A trava `scripts/verificar-commit.sh` bloqueia `.env`, chaves e imagens no repositório. Rode a skill `checagem-lgpd` antes de juntar mudanças em câmera, banco, API ou logs.

## Estrutura

```
services/backend/   Python 3.12+, FastAPI, SQLAlchemy, Alembic (uv)
  giro/dominio/     regras puras (máquina de estados da mesa), sem banco nem API
  giro/servicos/    liga o domínio ao banco, ao painel ao vivo e ao push; resultados, Copiloto e avisos do turno
  giro/api/         rotas; dependências de login e restaurante em deps.py
  giro/simulador/   faz o papel da câmera; cenários em cenarios/*.yaml
  giro/visao/       serviço de visão: detector, regra de mesa, prévia pixelada, avaliação
  giro/conector.py  pega a imagem do DVR (RTSP ou foto HTTP) e manda para a visão
  migrations/       Alembic
apps/web/           Next.js 16 (App Router, Cache Components), Tailwind 4, PWA (pnpm)
  src/components/salao-3d/  salão em 3D (three.js + react-three-fiber), só baixado quando abre
  public/modelos/           pessoas e decoração em .glb (gerados por infra/modelos-3d)
infra/              docker-compose e Dockerfiles; infra/render: demonstração online (render.yaml na raiz);
                    infra/modelos-3d: gera os modelos 3D do salão (Blender, fora da CI)
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
- Dados no painel: `useDados(buscar, chave)` (`src/lib/dados.ts`) para telas comuns e `useSalaoAoVivo` (`src/lib/ao-vivo.ts`) para o salão. Com a chave (uma por conteúdo: `estoque:1`, `pedido:7`), a tela reabre com o que buscou da última vez e atualiza por trás; essa memória some ao entrar ou sair da conta, então não guarde dado de tela no aparelho de outro jeito. Enquanto o dado não chega, use `Esqueleto` (`components/ui.tsx`), não a frase "Carregando...". Não chame setState direto dentro de useEffect (o lint barra).
- Conexão: `api()` avisa `src/lib/conexao.ts` a cada chamada, e a `FaixaDeConexao` (logo abaixo do menu, em toda tela) mostra "Sem conexão" e cuida da fila de pedidos. Quando o canal ao vivo cai e volta, `useSalaoAoVivo` chama o `aoAviso` com `{"tipo": "reconectou"}` (inventado pelo painel, não vem do servidor): tela com lista busca de novo, porque os avisos desse meio tempo se perderam. O Next guarda a tela anterior escondida: em teste de navegador, procure o texto dentro da região da tela (aba, lista), não na página inteira.
- Pedido e cozinha: contas puras em `src/lib/pedido.ts` (mais pedidos, rascunho, preço com centavos só quando tem, fila da cozinha por lançamento). Telas em `app/(painel)/pedido`, `cozinha` e `cardapio`. O canal ao vivo manda `{"tipo": "pedido"}`, `{"tipo": "cardapio"}` e `{"tipo": "estoque"}` só como aviso: quem precisa busca de novo (`useSalaoAoVivo(..., aoAviso)`). Uma `<dialog>` aberta precisa fechar ao sair da tela: o Next guarda a tela anterior escondida e a janela modal travaria a nova.
- Estoque: contas puras em `src/lib/estoque.ts` (kg, L e unidades para ler e digitar, custo pela ficha arredondado como o servidor, sugestão de "acabou", situação e "até quando", texto da compra com plural da embalagem e a lista para o WhatsApp). Tela em `app/(painel)/estoque` com Ingredientes, Lista de compras (gestão), Perdas (dono) e Fichas dos pratos. O "hoje" da tela vem do servidor (`estoque.hoje`): `Date.now()` durante o desenho da tela o lint barra. Tabela que rola de lado fica numa caixa `relative overflow-x-auto`: sem o `relative`, o texto `sr-only` escapa e a página do celular rola de lado.
- Resultados: contas e textos de data e dinheiro em `src/lib/resultados.ts` (horário de São Paulo, seja qual for o fuso do aparelho). O replay refaz o salão a partir dos horários das visitas em `src/lib/replay.ts`, no mesmo formato do ao vivo, e reaproveita o 3D e a planta (`components/planta.tsx`). Gráficos em `components/resultados/grafico-barras.tsx`: barras de uma série, destaque numa só, dica no mouse e nas setas, tabela escondida para leitor de tela.
- Salão 3D: as contas de posição ficam em `salao-3d/planta.ts` (testadas sem 3D), as do garçom em `garcom.ts`, as da câmera em `camera-mesa.ts` e a escolha de quem senta em `escolha-pessoas.ts`. As placas das mesas são botões comuns da página que o `Projetor` move; não use o `Html` do drei (perdia a placa da primeira mesa). Cores do 3D vêm dos tokens (`salao-3d/cores.ts`).
- Modelos 3D (pessoas e decoração) ficam em `apps/web/public/modelos/` e são gerados por `infra/modelos-3d/gerar.sh` (Blender + gltf-transform), nunca editados à mão. Clientes têm pose assada (sem esqueleto) e só o garçom tem esqueleto. Carregue com `useGLTF(url, false, true)` (meshopt, sem Draco, sem CDN) e reaproveite geometria e material (InstancedMesh). Crédito e licença de cada modelo em `public/modelos/CREDITOS.md`.
- Salão 3D tem 3 níveis de acabamento (`salao-3d/qualidade.ts`): alto (oclusão, brilho, sombra a cada quadro, respiração e garçom andando), médio e baixo (CI e aparelho fraco: sem efeitos, desenha sob demanda, garçom vai direto ao destino). Force com `?qualidade=alto|medio|baixo`. Sombra não se refaz sozinha fora do alto: quem muda o salão chama `useRefazerSombra`.
- Luz de ambiente do 3D: só a foto 360° local (`@pmndrs/assets`, import dinâmico) e os `Lightformer`. Nunca use `preset=` no `Environment` do drei (baixa de CDN).
- O selo "Pessoas ilustrativas: a câmera só conta, não filma ninguém." fica sempre visível na faixa logo abaixo do 3D, onde placa nenhuma o cobre (LGPD: o desenho não é imagem de câmera).
- Um modelo 3D que não baixa nunca derruba o salão: cada cliente fica num `LimiteDeErro` próprio e vira boneco simples. Modelo novo (.glb/.gltf) só em `public/modelos/` e listado no `manifesto.json` (a trava confere).
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
- **Fila de pedidos**: os pedidos lançados sem internet, guardados no aparelho do garçom até a rede voltar. Cada um leva a chave do lançamento, que impede o pedido em dobro.
- **Pendência**: uma linha da tela "Hoje": algo que pede atenção, com o que fazer e o link para a tela onde se resolve.
- **Acabou**: item que a cozinha marcou como sem estoque hoje (`itens_cardapio.disponivel = false`). O garçom vê riscado e não consegue lançar.
- **Ticket real**: o que cada pessoa gastou de verdade, pelos pedidos lançados (o "ticket médio" de Ajustes é só a estimativa).
- **Matriz de lucro**: estrela (vende muito e lucra bem), burro de carga (vende muito, lucra pouco), quebra-cabeça (lucra bem, pouca gente pede) e cão (vende pouco e lucra pouco).
- **Ficha técnica**: a receita de um prato, com quanto de cada ingrediente vai em uma porção (`fichas_tecnicas`). Liga o pedido ao estoque e calcula o custo do prato.
- **Livro do estoque**: cada compra, venda, estorno, perda, contagem e saldo de partida (`inicial`) é uma linha (`movimentos_estoque`); o saldo do ingrediente é a soma delas.
- **CMV**: custo da mercadoria vendida. Pela ficha, o que os pratos vendidos deveriam ter gastado; de verdade, o que saiu do estoque contado. A diferença é o que escapou.
- **Curva ABC**: os poucos ingredientes (A) que somam 80% do que sai do estoque. São os que valem uma contagem toda semana.
