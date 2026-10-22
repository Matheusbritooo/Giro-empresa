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

**Fases 0 (fundação), 1 (salão no simulador) e 2 (visão computacional) prontas.**

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

![Tela Câmeras: desenho das mesas sobre a foto](docs/telas/cameras-desenhando.png)

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
6. Feche com **Ver como a câmera** no 3D: a câmera do salão, o que ela enxerga e a frase de privacidade (conta pessoas, não reconhece ninguém).

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

## Demonstração online (grátis, com HTTPS)

Para mostrar o painel para a banca ou para um cliente sem instalar nada, o repositório já vem pronto para o [Render](https://render.com), no plano grátis. Sobe o painel, a API e o simulador numa noite aleatória que não para, num endereço `https://...onrender.com`.

1. Junte o PR com a pasta `infra/render` na `main`.
2. Crie a conta no Render com **Sign in with GitHub** e libere o acesso ao repositório `Giro-empresa`.
3. No Render, clique em **New > Blueprint**, escolha o repositório e a branch `main`. Ele lê o `render.yaml` e mostra o serviço `giro-demo` e o banco `giro-demo-banco`.
4. Preencha `GIRO_SENHA_DEMO` com a senha de todos os acessos de demonstração (mínimo 10 letras) e clique em **Deploy Blueprint**.
5. Em 5 a 10 minutos o endereço aparece no topo do serviço `giro-demo`. Entre com `marcos@cantina.demo` (dono), `gerente@cantina.demo` ou `equipe@cantina.demo` e a senha do passo 4.

Para trocar a senha depois: **giro-demo > Environment > GIRO_SENHA_DEMO**, salve e espere o serviço reiniciar.

O que saber do plano grátis:

- **Dorme depois de 15 minutos sem visita.** A primeira visita depois disso leva cerca de 1 minuto e o salão recomeça do zero. Antes da apresentação, abra o link uns 2 minutos antes.
- **O banco grátis expira em 30 dias.** O Render avisa por e-mail. Dá para apagar o banco e rodar o Blueprint de novo, ou passar o banco para um plano pago.
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
| 3. Inteligência | Painel de desempenho (giro, tempo de atendimento, mesa parada, horário de pico), previsão da próxima mesa a vagar, relatório semanal "quanto a GIRO te devolveu" |
| 4. Gestão GIRO | Leads com as perguntas de qualificação, assinatura e cobrança (Asaas), painel financeiro |
| 5. Site | Página de vendas e calculadora de retorno |
