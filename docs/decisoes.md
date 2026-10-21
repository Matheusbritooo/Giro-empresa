# Decisões técnicas

Cada decisão tem o contexto, o que foi decidido e o que isso custa. Quando uma decisão mudar, não apague: escreva uma nova dizendo qual substitui. É o mesmo princípio do item 1.10 do TCM (por que mudamos o produto).

## 1. Simulador antes da câmera

**Contexto.** Sem um restaurante parceiro com câmera liberada, a visão computacional não pode ser testada de verdade. Mas o painel, os alertas e as regras da mesa não dependem da câmera.

**Decisão.** A Fase 1 roda com um simulador que manda exatamente o que a visão computacional vai mandar: por mesa, quantas pessoas sentadas e quantas em pé. A visão (Fase 2) entra no lugar do simulador sem mudar banco, API ou painel.

**Consequência.** O sistema pode ser demonstrado na banca e para clientes antes da Fase 2. Os cenários do simulador viram testes automáticos das regras da mesa.

## 2. Visão computacional em servidor próprio, não em API cobrada por foto

**Contexto.** O anexo A.1 do TCM orça R$ 65 por cliente/mês para processamento de visão. Uma foto a cada 10 segundos, 8 horas por dia, dá 86.400 fotos por câmera no mês.

**Conta.** Em APIs que cobram por imagem (AWS Rekognition, Google Vision) o preço fica entre US$ 1 e US$ 2,25 por mil imagens: algo a partir de R$ 450 por câmera no mês, sete vezes o orçado. Rodando um detector de pessoas leve num servidor próprio, um servidor de R$ 300 a R$ 800 por mês processa 50 clientes ou mais (cada cliente com 2 câmeras gera 0,2 foto por segundo), o que dá entre R$ 6 e R$ 16 por cliente.

**Decisão.** Detector próprio rodando em processador comum (sem placa de vídeo).

**Consequência.** Custo de visão bem abaixo do orçado, o que melhora a margem de contribuição da Missão 08. Em troca, a GIRO opera o servidor. Os números são estimativas e precisam ser confirmados com propostas reais nas Missões 05 e 07.

## 3. Detector com licença livre

**Contexto.** O detector mais popular (YOLO da Ultralytics) tem licença AGPL: para vender como serviço é preciso comprar a licença comercial ou abrir todo o código.

**Decisão.** O código da Fase 2 vai usar o detector por trás de uma interface trocável e começar com um de licença Apache 2.0 (RF-DETR ou RT-DETR). A contagem de pessoas por mesa usa a biblioteca `supervision` (MIT).

## 4. Alertas por notificação do navegador (Web Push), WhatsApp depois

**Contexto.** O dono usa WhatsApp, mas a API oficial cobra por mensagem e exige aprovação de modelo de mensagem na Meta.

**Decisão.** Fase 1 usa Web Push: grátis, funciona no Android e no iPhone (com o painel instalado na tela inicial). Alerta de atendimento vai para dono e gerente; alerta de mesa vaga vai para todos.

**Consequência.** Custo zero por alerta. WhatsApp entra quando houver cliente pagando, como diferencial do relatório semanal.

## 5. Um domínio só, com sessão em cookie protegido

**Decisão.** Em produção, o Caddy serve o painel e manda `/api` para o backend no mesmo domínio. A sessão fica num cookie `HttpOnly`, `SameSite=Lax` e `Secure`, que o JavaScript da página não consegue ler. O canal ao vivo só aceita conexões vindas do próprio painel.

**Consequência.** Menos superfície de ataque e nada de configuração de CORS em produção.

## 6. Estado da mesa calculado no servidor, guardado no banco

**Decisão.** A máquina de estados (`giro/dominio/mesa.py`) é código puro, sem banco. O estado de cada mesa é salvo numa coluna JSON a cada foto, e cada mudança gera um evento e atualiza a ocupação.

**Consequência.** O servidor pode reiniciar no meio do serviço sem perder nada. Mesas são travadas no banco durante a atualização (`SELECT ... FOR UPDATE`, sempre na mesma ordem) para a foto da câmera e o relógio dos alertas não brigarem.

## 7. Tecnologias

| Camada | Escolha | Por quê |
|---|---|---|
| Backend | Python, FastAPI, SQLAlchemy, Alembic | Mesma linguagem da visão computacional |
| Banco | PostgreSQL (SQLite nos testes rápidos) | Confiável, gratuito, roda em qualquer servidor |
| Painel | Next.js 16, Tailwind 4, PWA | Um app só para computador e celular, instalável sem loja |
| Fontes | Big Shoulders Display (números de mesa) e Atkinson Hyperlegible Next (texto) | Números legíveis de longe; texto feito para leitura fácil. Servidas pelo próprio painel, sem chamar o Google |
| Servidor | Docker, Caddy | Um servidor só no começo, HTTPS automático |
