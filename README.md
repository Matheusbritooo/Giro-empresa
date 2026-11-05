# GIRO

**A câmera que já está no teto agora conta o tempo das suas mesas.**

A GIRO liga na câmera de segurança que o restaurante já tem, analisa uma foto a cada 10 segundos e mostra o salão ao vivo: quais mesas estão livres, quais estão esperando atendimento, quais estão ocupadas e quais vagaram e precisam ser limpas. Se um cliente senta e passa 5 minutos sem ninguém ir até a mesa, o gerente recebe um alerta no celular.

Projeto do TCM *O Segredo do Meu Negócio* (Técnico em Administração), da equipe Almir, Gabriel, Ingrid, Matheus e Vitória.

![Salão ao vivo em 3D no computador](docs/telas/salao-3d.png)

<p>
  <img src="docs/telas/salao-celular.png" alt="Salão no celular, na planta" width="260">
  <img src="docs/telas/salao-celular-escuro.png" alt="Salão no celular, tema escuro" width="260">
  <img src="docs/telas/salao-3d-celular.png" alt="Salão em 3D no celular" width="260">
</p>

## O que já funciona

**Fases 0 (fundação), 1 (salão no simulador) e 2 (visão computacional) prontas. Fase 3 (inteligência) com resultados, replay, "E se?" e Copiloto. Cardápio e pedidos na mesa (etapas 1 e 2) e o estoque com lista de compras (etapa 3, partes 1 e 2).**

- Mapa de mesas ao vivo, com cronômetro em cada mesa e as cadeiras ocupadas desenhadas em volta.
- **Salão em 3D realista**: a cantina inteira à noite (piso de tábua, lambri, toalha xadrez, balcão com flores, geladeira de bebidas, plantas, arandelas, a câmera no canto), com clientes de verdade sentados em cada mesa ocupada, o cardápio na mesa de quem espera, o prato servido e a louça suja na mesa para limpar. Um garçom anda pelos corredores até a mesa de quem tocou "Vou atender", anota o pedido e volta ao balcão. Nos alertas, **Ver no salão** leva a câmera do 3D até a mesa. Gira com o dedo ou o mouse, e tocar na placa da mesa abre o mesmo detalhe com "Liberar mesa". O botão **Ver como a câmera** mostra o campo de visão e o contorno que a visão desenha em volta de cada pessoa. As pessoas são ilustrativas (o selo logo abaixo do 3D diz isso): a câmera só conta, não filma ninguém. O acabamento se ajusta ao aparelho (alto, médio ou baixo; dá para forçar com `?qualidade=alto` na URL). No computador abre em 3D; no celular, na planta (dá para trocar, e o aparelho lembra).
- Alerta de cliente sem atendimento (5 min, ajustável pelo dono) e alerta de mesa vaga, com som no painel e notificação no celular.
- Botões "Vou atender" e "Liberar mesa": quando um garçom toca, todos os aparelhos atualizam na hora.
- Registro de cada visita à mesa (sentou, foi atendida, saiu, foi liberada), que é a base dos indicadores da Fase 3.
- Perfis de acesso: equipe do salão, gerente, dono e equipe GIRO (que ativa clientes novos).
- Cadastro de mesas na planta, equipe, câmeras e ajustes do restaurante.
- Simulador de salão que faz o papel da câmera, com cenários prontos e noite aleatória para demonstração.
- Funciona como aplicativo no celular (PWA), sem loja de apps, nos temas claro e escuro.

Visão computacional (Fase 2):

- Detector de pessoas YOLOX rodando em processador comum, sem placa de vídeo.
- Regra de mesa: quem está sentado em qual mesa e quem está em pé junto dela (o garçom).
- Conector que pega a imagem do gravador do restaurante (RTSP ou foto HTTP, Intelbras e Hikvision) e manda 1 foto a cada 10 segundos.
- Tela **Câmeras**: o técnico desenha cada mesa tocando nos cantos sobre a foto, vê a contagem ao vivo e calibra a câmera. As pessoas aparecem pixeladas e a foto não é guardada.
- Aviso no salão quando uma câmera para de mandar imagem.
- Ferramenta para medir o acerto da visão com vídeo real e escolher a calibração.

Resultados e Copiloto (Fase 3, para dono e gerente):

- **Dinheiro que ficou na mesa**: quanto deixou de entrar na noite, na semana ou nas 4 semanas, em forma de comanda: quem foi embora sem atendimento (pessoas × ticket médio) e mesa suja com o salão cheio (minutos parada além de 3 min, nas horas com 75% das mesas ocupadas, convertidos em clientes que caberiam ali). Compara com o mesmo dia da semana anterior.
- Números da noite (mesas atendidas, giro, espera até o garçom, mesa parada, quem foi embora), ocupação por hora com o pico, perda noite a noite e as mesas que mais custaram.
- **Replay da noite**: o salão (3D ou planta) refeito minuto a minuto só com os horários de cada mesa, com play, velocidade, os momentos que valem rever e a noite de cada mesa. O **mapa de calor** pinta em volta das mesas onde o salão travou.
- **E se?**: o dono mexe no tempo de limpeza e no número de garçons e vê quanto entraria a mais por mês, com base nas últimas 4 semanas do próprio salão.
- **Copiloto GIRO**: o recado do dia antes do turno ("hoje é sexta, o salão enche às 20h, a mesa 7 é a que mais fica parada") e uma caixa para perguntar em português. Funciona sem IA, com respostas prontas; com a chave da Anthropic, responde com IA (veja [Copiloto com IA](#copiloto-com-ia-opcional)).
- No celular, aviso "Antes do turno" na hora de abrir e "Resumo da noite" na hora de fechar (com o aviso no celular ligado).
- Em **Ajustes**, o dono informa quanto cada pessoa gasta em média e o horário de abrir e fechar.

![Resultados: dinheiro que ficou na mesa, Copiloto e números da semana](docs/telas/resultados.png)

![Replay da noite com o mapa de calor](docs/telas/replay-calor.png)

Cardápio e pedidos na mesa (etapa 1):

- **Lançar pedido em 3 toques**: no detalhe da mesa, "Lançar pedido" abre o cardápio com os 8 itens que mais saem no topo, as categorias e a busca. Dá para pôr observação para a cozinha ("sem cebola"). O primeiro pedido já conta a mesa como atendida e tira o alerta de "mesa sem atendimento"; em mesa livre, ele abre a visita.
- **Tela da cozinha**: a fila do que falta sair, por mesa e do mais antigo para o mais novo, com o botão "Pronto". Depois de 20 minutos o pedido fica em destaque. Atualiza sozinha.
- **Gestão do cardápio**: categorias e itens com preço, "tem hoje" (a cozinha marca que acabou e o garçom vê riscado na hora), tirar e voltar com item. Custo e lucro de cada prato só o dono vê. Preço novo vale só para os próximos pedidos: o que já foi lançado guarda o preço da hora.
- **Cancelar item** só gerente e dono, escolhendo o motivo. Fica registrado quem cancelou e quando.
- No salão, o detalhe da mesa mostra quanto ela já gastou e quantos itens faltam sair da cozinha.
- Em Resultados: prato e bebida do período, os mais pedidos, o que cada mesa mais pediu e o **ticket real**. Com 5 ou mais mesas com pedido, o "dinheiro que ficou na mesa" passa a usar o que as mesas gastaram de verdade, e não o valor de Ajustes.
- O GIRO não emite nota fiscal nem recebe pagamento: isso continua no caixa do restaurante. O pedido é da mesa, sem nome nem documento do cliente. A observação é só para a cozinha: não escreva nome de cliente nela.

Cardápio, etapa 2 (gestão):

- **Pediu a conta**: um toque no detalhe da mesa (ou na tela do pedido). A mesa mostra "Conta" e quando deve vagar, pela mediana das contas das últimas 4 semanas (10 minutos enquanto não há histórico). Tocou sem querer, "Desfazer".
- **Matriz de lucro dos pratos** (só o dono, que vê o custo): engenharia de cardápio de Kasavana e Smith, dentro de cada categoria. Estrela (vende muito e lucra bem: manter), burro de carga (vende muito, lucra pouco: subir o preço ou baratear a receita), quebra-cabeça (lucra bem, pouca gente pede: o garçom indicar) e cão (vende pouco e lucra pouco: pensar em tirar). Prato sem custo informado fica fora e aparece avisado.
- **Quem pede também pede**: para os pratos que mais saem, a bebida, a entrada e a sobremesa que essas mesas pedem mais do que as outras (refrigerante sai com tudo e não ensina nada ao garçom).
- **Tempo de cozinha** de cada prato, do lançamento até o "Pronto", com sexta e sábado à parte.
- **Copiloto** responde "qual prato eu tiro do cardápio?", "qual prato mais sai?", "qual demora mais?" e "o que oferecer junto?", e o recado do dia lembra do estoque do prato que mais sai.

![Matriz de lucro, quem pede também pede e tempo de cozinha](docs/telas/matriz-de-lucro.png)

Cardápio, etapa 3, parte 1 (estoque):

- **Ficha técnica de cada prato**: quanto de cada ingrediente vai em uma porção, mais o custo de "outros" (tempero, óleo). Com ficha, o custo do prato é calculado pela ficha e acompanha o preço das compras: a matriz de lucro fica sempre em dia. A equipe vê a ficha sem valores, para servir a porção igual todo dia.
- **Estoque que baixa sozinho**: cada prato lançado tira do estoque o que a ficha diz. Cancelado antes do "Pronto", volta; depois do "Pronto", vira perda ("Prato cancelado"). Prato sem ficha não mexe no estoque.
- **Chegou compra, perda e contagem**: o gerente lança a compra com o valor da nota (o preço do ingrediente vira o custo médio do que tinha com o que chegou); qualquer um registra perda com o motivo da lista; a contagem substitui a conta e mostra a diferença.
- **Livro de cada ingrediente**: tudo o que entrou e saiu, com quem lançou e quando. Nada se apaga.
- Ingrediente zerado pela conta sugere marcar "acabou" nos pratos que o usam. O GIRO nunca marca sozinho: a conta pode estar errada.
- Controle só o que pesa no bolso (10 a 20 ingredientes: carnes, queijos, massas, bebidas). O seed traz 18 ingredientes da Cantina, as fichas de 15 itens e 4 semanas de compras, vendas, contagens e perdas.

![Estoque da Cantina com o livro da muçarela aberto](docs/telas/estoque.png)

Cardápio, etapa 3, parte 2 (previsão e compras):

- **Até quando dá**: cada ingrediente mostra quando acaba ("acaba amanhã") e a situação: **Vai faltar** (acaba antes de a próxima compra chegar), **Comprar** (entra na lista), **Tem** ou **Zerado**. Vermelho só para o urgente.
- **Lista de compras** (gerente e dono): para a próxima compra, agrupada por onde se compra, com o valor estimado pelo preço médio. Toque num item e veja o porquê: o que tem, o que ainda sai até a compra, o que sai nas noites que ela cobre (e de quais pratos), a folga e o que falta, arredondado na embalagem ("8 pacotes de 1 kg").
- **Como prevê**: para cada prato, o valor do meio das últimas 4 noites iguais (as últimas 4 sextas, por exemplo). Uma sexta de feriado não puxa a conta. A noite de hoje entra só com o que ainda falta vender.
- **Copiar para o WhatsApp**: a lista sai em texto, por fornecedor e sem preço.
- **Ajustes** (dono): dias de compra (padrão terça e sexta) e folga (padrão 15%). Num fim de semana de feriado, a folga muda só na tela da lista.
- **Copiloto** responde "o que eu preciso comprar?" e "o que está acabando?", e o recado antes do turno avisa o que acaba antes da compra (primeiro na notificação quando acaba hoje).

![Lista de compras de sexta com o porquê da massa de lasanha](docs/telas/lista-de-compras.png)

![Pedido da mesa no celular do garçom](docs/telas/pedido-celular.png)

![Tela da cozinha com a fila por mesa](docs/telas/cozinha.png)

![O que saiu da cozinha: prato da semana e o que cada mesa mais pediu](docs/telas/resultados-cardapio.png)

![Tela Câmeras: desenho das mesas sobre a foto](docs/telas/cameras-desenhando.png)

![Alerta da mesa 10 com "Ver no salão": a câmera do 3D vai até a mesa que espera atendimento](docs/telas/salao-3d-perto.png)

![Salão em 3D no modo "Ver como a câmera"](docs/telas/salao-3d-camera.png)

*Ilustração de salão vazio usada como foto da câmera. Com gente, cada pessoa aparece pixelada e com uma caixa branca (sentada) ou amarela (em pé).*

## Rodar no seu computador

Precisa de [uv](https://docs.astral.sh/uv/) (Python) e [pnpm](https://pnpm.io/) (Node 22).

```bash
make instalar   # dependências e trava de commit
make dados      # cria o banco (SQLite) e a Cantina do Marcos com 14 mesas
make dev        # API (:8000), visão (:8001) e painel (http://localhost:3000)
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
3. Mostre o alerta da mesa 4 sem atendimento, toque em "Vou atender" no celular e veja o computador atualizar. No computador, o salão em 3D mostra a mesa 4 pulsando em vermelho.
4. Quando a mesa 1 vagar, toque em "Liberar mesa". Toque na mesa 7 para mostrar a linha do tempo: quando sentaram, quanto esperaram e há quanto tempo está parada.
5. No alerta da mesa 4, toque em **Ver no salão**: a câmera do 3D vai até a mesa e o garçom aparece indo atender.
6. Mostre **Ver como a câmera** no 3D: a câmera do salão, o que ela enxerga e a frase de privacidade (conta pessoas, não reconhece ninguém).
7. Entre como dono (`marcos@cantina.demo`) e abra **Resultados** em "7 dias": o dinheiro que ficou na mesa, a comanda e a mesa que mais custou. O seed já traz 4 semanas de noites de demonstração.
8. Toque em **Rever a pior noite**, depois em **Assistir** e ligue o **Mapa de calor**. Toque num momento da noite para a câmera ir até a mesa.
9. Mostre o **E se?**: arraste "Mesa limpa em até" para 3 min e mostre quanto entraria por mês. Pergunte ao Copiloto "Qual mesa mais me dá prejuízo?".
10. Pedido na mesa: no celular do garçom, toque numa mesa, em **Lançar pedido**, escolha 2 lasanhas e um refrigerante e lance. No computador, abra **Cozinha**: o pedido aparece na hora. Toque em **Pronto** e veja o celular atualizar.
11. Com a mesa ainda aberta no salão, toque em **Pediu a conta**: a mesa mostra quando deve vagar.
12. Feche com o dono em **Resultados**, "4 semanas": o prato do mês, o que cada mesa mais pediu e a **matriz de lucro** (Ravioli e Fettuccine caem em "cão"). Pergunte ao Copiloto "Qual prato eu tiro do cardápio?". O seed já traz o cardápio da cantina (22 itens) e os pedidos das 4 semanas.
13. Abra **Estoque**: os 18 ingredientes, o que cada um tem e o **livro** da muçarela (vendas de cada noite, compras de terça e sexta, contagem de segunda). Em **Fichas dos pratos**, mostre o Fettuccine: pela ficha ele custa mais do que o digitado antes. Lance um pedido no celular e veja o estoque baixar na hora.
14. Ainda em **Estoque**, abra a **Lista de compras**: o que comprar na próxima compra, por fornecedor. Toque em "Por que?" na massa de lasanha e mostre a conta. Pergunte ao Copiloto "O que eu preciso comprar?".

Os cenários disponíveis aparecem com `uv run python -m giro.simulador listar`.

## Ligar uma câmera de verdade

1. No painel, como dono, vá em **Ajustes > Câmeras**, cadastre a câmera e copie a chave (aparece uma vez só).
2. Num computador na mesma rede do gravador (o do caixa serve, ou o notebook do vendedor na demonstração), rode o conector:
   ```bash
   cd services/backend
   export GIRO_TOKEN=cam_...
   export GIRO_FONTE="rtsp://usuario:senha@192.168.0.20:554/cam/realmonitor?channel=1&subtype=0"
   uv run python -m giro.conector --visao https://SEU-DOMINIO
   ```
   Com as variáveis, a senha do gravador não fica no histórico do terminal nem na lista de programas abertos. O endereço da visão precisa ser `https://` (o conector recusa `http` fora da própria máquina).
   Endereços comuns (confira no manual do modelo):

   | Gravador | Transmissão (RTSP) | Foto (HTTP) |
   |---|---|---|
   | Intelbras | `rtsp://usuario:senha@IP:554/cam/realmonitor?channel=1&subtype=0` | `http://usuario:senha@IP/cgi-bin/snapshot.cgi?channel=1` |
   | Hikvision | `rtsp://usuario:senha@IP:554/Streaming/Channels/101` | `http://usuario:senha@IP/ISAPI/Streaming/channels/101/picture` |

3. Em até 10 segundos a foto aparece em **Câmeras**, com as pessoas pixeladas. Toque em **Desenhar** ao lado de cada mesa e marque os cantos da mesa com as cadeiras.
4. Confira a contagem ao lado de cada mesa. Se errar, ajuste a **Calibração** na mesma tela.

Para testar sem gravador, o conector também aceita um vídeo gravado do salão (`--fonte salao.mp4`) ou uma pasta de fotos. Quando mostra a fonte na tela, o conector troca usuário e senha por `***`, e nenhuma foto é gravada em disco.

## Como funciona

```
DVR ──rede local──► conector ──1 foto a cada 10s, HTTPS──► serviço de visão ─┐
                                   (acha pessoas, conta por mesa, descarta)   │
Simulador (demonstração) ────────────────────────────────────────────────────┤
                                                                             ▼
                                                     POST /api/ingest/observacoes
                                                     (só números: sentados e em pé por mesa)
                                                                             │
                                                         máquina de estados da mesa
                                                                             │
                              ┌──────────────────────────┬───────────────────┴──────┐
                              ▼                          ▼                          ▼
                       banco (histórico)     painel ao vivo (WebSocket)    celular (Web Push)
```

A foto nunca chega à API: o serviço de visão analisa e descarta. O que fica gravado são eventos em texto, como "mesa 4 ocupada às 20h41" (LGPD, seção 1.9 do TCM). Para o desenho das mesas existe só uma prévia com as pessoas pixeladas, na memória, por 3 minutos.

## Estrutura

```
services/backend/   API em Python (FastAPI, SQLAlchemy, Alembic), visão, conector e simulador
apps/web/           Painel em Next.js 16 e Tailwind, instalável no celular
infra/              Docker, Postgres e Caddy para colocar no ar
docs/               decisões técnicas e telas
scripts/            trava de commit (LGPD e segredos)
.claude/            hooks, skills e agentes do Claude Code para este projeto
```

## Modelos 3D do salão

As pessoas do salão em 3D são os avatares da [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) (licença MIT): 6 clientes com 3 poses sentadas cada (pose assada, sem esqueleto) e um garçom com esqueleto e os clipes parado, andando e anotando. Os arquivos prontos ficam em `apps/web/public/modelos/` (uns 2 MB, baixados do próprio painel quando o 3D abre, nunca de CDN), com o `manifesto.json`, os créditos em `CREDITOS.md` e a licença em `LICENSE-Rocketbox.md`. A decoração (planta, vaso de flores no balcão e a geladeira de bebidas) vem dos modelos de exemplo do [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (CC BY 4.0 e CC0; autoria de cada um em `CREDITOS.md`, que o próprio 3D linka em "Créditos dos desenhos") e só baixa nos níveis alto e médio; no baixo fica a decoração desenhada no código. A luz de ambiente é uma foto 360° CC0 (Poly Haven, via `@pmndrs/assets`), também empacotada no painel.

Para gerar os modelos de novo (Blender como módulo do Python, `bpy` 5.2.2, e Node):

```bash
BPY_PYTHON=/caminho/venv-bpy/bin/python infra/modelos-3d/gerar.sh
```

O passo a passo, as medidas conferidas em cada pose e como trocar uma pessoa estão em [`infra/modelos-3d/README.md`](infra/modelos-3d/README.md). Nada disso roda na CI.

## Testes

```bash
make testes   # lint, testes do backend, cenários do salão e testes do painel
make e2e      # navegador de verdade, no celular e no computador
```

A CI do GitHub roda tudo isso em cada PR, inclusive contra Postgres, e confere se as migrações do banco batem com o código.

## Copiloto com IA (opcional)

Sem configurar nada, o Copiloto responde com regras prontas a partir dos números do salão. Para respostas com IA (Claude, da Anthropic), crie uma chave em [console.anthropic.com](https://console.anthropic.com) e coloque na API como `GIRO_ANTHROPIC_API_KEY` (no Render: **giro-demo > Environment > Add Environment Variable**). Se a IA estiver fora do ar, sem crédito ou recusar, o Copiloto volta para as respostas prontas sozinho.

O que vai para a Anthropic, e só isso: o nome do restaurante, o horário de funcionamento, o ticket médio, números somados por noite, por mesa e por hora das últimas 4 semanas (mesas atendidas, giro, espera média, mesa parada, quem foi embora, ocupação, valor estimado), números somados do cardápio (quantas vezes cada item saiu e quanto vendeu, o que sai junto com cada prato, o tempo de cozinha), as quantidades do estoque (quanto tem de cada ingrediente, quando acaba e quanto comprar, sem valor em reais) e a pergunta digitada pelo dono ou gerente. Quando quem pergunta é o dono, vai também em qual quadro da matriz de lucro cada prato ficou; o custo em reais nunca vai. Nunca vai imagem, nome de pessoa, e-mail ou dado de cliente. Cada restaurante pode fazer até 60 perguntas por hora.

## Demonstração online (grátis, com HTTPS)

Para mostrar o painel para a banca ou para um cliente sem instalar nada, o repositório já vem pronto para o [Render](https://render.com), no plano grátis. Sobe o painel, a API e o simulador numa noite aleatória que não para, num endereço `https://...onrender.com`.

1. Junte o PR com a pasta `infra/render` na `main`.
2. Crie a conta no Render com **Sign in with GitHub** e libere o acesso ao repositório `Giro-empresa`.
3. No Render, clique em **New > Blueprint**, escolha o repositório e a branch `main`. Ele lê o `render.yaml` e mostra o serviço `giro-demo` (o banco é um arquivo dentro dele, não aparece à parte).
4. Preencha `GIRO_SENHA_DEMO` com a senha de todos os acessos de demonstração (mínimo 10 letras) e clique em **Deploy Blueprint**.
5. Em 5 a 10 minutos o endereço aparece no topo do serviço `giro-demo`. Entre com `marcos@cantina.demo` (dono), `gerente@cantina.demo` ou `equipe@cantina.demo` e a senha do passo 4.

Para trocar a senha depois: **giro-demo > Environment > GIRO_SENHA_DEMO**, salve e espere o serviço reiniciar.

O que saber do plano grátis:

- **Dorme depois de 15 minutos sem visita.** A primeira visita depois disso leva cerca de 1 minuto e o salão recomeça do zero. Antes da apresentação, abra o link uns 2 minutos antes.
- **Resultados de demonstração.** Cada vez que acorda, as noites passadas viram as 4 semanas de demonstração (as mesmas de `giro/demo_historico.py`); a noite de hoje é a do simulador ao vivo.
- **Banco em arquivo, sem prazo.** A demonstração guarda tudo num arquivo SQLite dentro do serviço, que some quando ele dorme e é refeito quando acorda. Não há banco à parte para vencer nem para pagar.
- **Servidor fora do Brasil e só dados simulados.** Câmera e cliente de verdade vão para um servidor próprio (próxima seção). A visão e o aviso no celular ficam desligados nessa demonstração: não cabem nos 512 MB do plano grátis.

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
- Skills: `simular-salao`, `checagem-lgpd`, `mudanca-no-banco` e `validar-visao`.
- Agentes: `guardiao-lgpd` (revisa privacidade, só lê), `testador-salao` (roda tudo e relata) e `especialista-visao` (calibra a visão com vídeo real).
- Hooks: formatam o código a cada edição e preparam as sessões na nuvem.
- No GitHub, escreva `@claude` numa issue ou PR para pedir uma tarefa ou revisão (precisa instalar o app do Claude no repositório e configurar o segredo `CLAUDE_CODE_OAUTH_TOKEN`; o comando `/install-github-app` do Claude Code faz isso).

## Próximas fases

| Fase | Entrega |
|---|---|
| 2b. Calibração em campo | Medir a visão com vídeo de um restaurante parceiro; receber a foto do gravador por FTPS para dispensar o conector |
| 3. Inteligência (resto) | Previsão da próxima mesa a vagar, relatório semanal por e-mail "quanto a GIRO te devolveu" |
| Cardápio, etapa 3 (partes 3 e 4) | Perdas (custo pela ficha contra o de verdade) e curva ABC; importar a planilha de vendas do sistema de caixa |
| 4. Gestão GIRO | Leads com as perguntas de qualificação, assinatura e cobrança (Asaas), painel financeiro |
| 5. Site | Página de vendas e calculadora de retorno |
