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

**Fases 0 (fundação), 1 (salão no simulador) e 2 (visão computacional) prontas.**

- Mapa de mesas ao vivo, com cronômetro em cada mesa e as cadeiras ocupadas desenhadas em volta.
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
3. Mostre o alerta da mesa 4 sem atendimento, toque em "Vou atender" no celular e veja o computador atualizar.
4. Quando a mesa 1 vagar, toque em "Liberar mesa". Toque na mesa 7 para mostrar a linha do tempo: quando sentaram, quanto esperaram e há quanto tempo está parada.

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
