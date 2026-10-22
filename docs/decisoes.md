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

## 8. Detector YOLOX (substitui a escolha da decisão 3)

**Contexto.** A decisão 3 previa RF-DETR ou RT-DETR. Na hora de construir, os dois exigem PyTorch para gerar o modelo em ONNX, o que pesa a instalação e o servidor.

**Decisão.** YOLOX, da Megvii: licença Apache 2.0, modelo pronto em ONNX publicado pelos autores, roda com ONNX Runtime sem PyTorch. Três tamanhos, com tempo medido por foto num núcleo de CPU: `yolox_s` 220 ms (padrão), `yolox_tiny` 65 ms, `yolox_nano` 25 ms. O arquivo do modelo é conferido por hash antes de usar. A contagem por mesa foi escrita à mão (`giro/visao/leitura.py`) em vez de usar a biblioteca `supervision`, que traria OpenCV e Matplotlib para o servidor.

**Consequência.** Com 2 câmeras por restaurante e uma foto a cada 10 s (0,2 foto por segundo), um núcleo com `yolox_s` atende uns 20 restaurantes, e um servidor de 4 núcleos, uns 80. Isso confirma a conta da decisão 2. Se a precisão do `yolox_s` não bastar no vídeo real, o próximo passo é testar o modelo em resolução maior, não trocar de licença.

## 9. Visão num serviço separado da API

**Decisão.** A visão roda num processo próprio (`giro/visao/servico.py`, porta 8001). Ela recebe a foto, confere o token da câmera na própria API (com cache de 10 s), conta pessoas por mesa e manda só os números para a mesma rota que o simulador usa. A API pede a prévia para a visão por rotas internas protegidas por segredo, que o Caddy nunca expõe.

**Consequência.** Análise de imagem, que pesa no processador, não atrasa o painel ao vivo nem os alertas. Dá para colocar a visão em outra máquina quando crescer. Se a visão cair, o painel continua no ar e mostra "câmera parou de mandar imagem".

## 10. Prévia pixelada, só em memória

**Decisão.** Para o técnico desenhar as mesas, o painel mostra a última foto da câmera com cada pessoa transformada em blocos grandes (6 na largura da pessoa). A prévia fica na memória do serviço de visão por 3 minutos e é servida com `Cache-Control: no-store`. A foto original não sobrevive ao fim da análise.

**Consequência.** O desenho das mesas não exige ver ninguém. Cumpre o item 1.9 do TCM: a imagem é tratada com o mínimo necessário e nunca vira identificação de pessoa.

## 11. Conector no restaurante em vez de FTP do gravador

**Contexto.** O TCM diz que "o gravador envia à nuvem um quadro a cada dez segundos". Boa parte dos DVRs faz isso por FTP, que manda usuário, senha e a foto do salão sem criptografia pela internet.

**Decisão.** Fase 2 usa o conector GIRO (`giro/conector.py`): um programa que roda num computador do restaurante (ou no notebook do vendedor na demonstração), lê a imagem do DVR pela rede local (RTSP ou foto HTTP), reduz para 1280 px e manda por HTTPS. Uma foto de ~150 KB a cada 10 s dá uns 120 kbps, dentro dos 160 kbps do TCM.

**Consequência.** Exige um computador ligado no restaurante, o que o TCM evitava ("nada é instalado"). Receber por FTPS (FTP com criptografia), que alguns DVRs suportam, pode eliminar o conector numa fase seguinte. Vale atualizar o item 1.3 do TCM com essa condição.

## 12. Regra de sentado e em pé provisória

**Decisão.** Sem vídeo real ainda, a regra usa a proporção da caixa da pessoa (em pé = mais de 2,2 vezes mais alta que larga) e a posição do ponto de apoio em relação ao desenho da mesa. Cada câmera pode ser calibrada pelo painel.

**Consequência.** É o ponto de maior risco técnico do produto: câmera muito alta deixa gente em pé "baixa" na imagem. A ferramenta `giro/visao/avaliar.py` e a skill `validar-visao` medem o acerto contra uma contagem feita à mão e sugerem a calibração. A meta antes do primeiro cliente pagante é acertar 95% das vezes se a mesa está ocupada e 85% das vezes se o garçom está na mesa.

## 13. Demonstração online no Render, num contêiner só

**Contexto.** A equipe precisa de um link com HTTPS para mostrar o painel na banca e para clientes, sem pagar servidor nem comprar domínio agora.

**Decisão.** Render no plano grátis, configurado pelo `render.yaml` (Blueprint). Painel, API e simulador rodam num contêiner só (`infra/render/`), atrás de um Caddy sem HTTPS próprio: o Render entrega o certificado no endereço `onrender.com`. A visão fica de fora: medimos uns 190 MB para painel, API e simulador e uns 450 MB com a visão, perto demais do limite de 512 MB. Em produção pública, os dados de demonstração só são criados com `GIRO_DEMO=1`, a senha vem de `GIRO_SENHA_DEMO` (a `giro1234` do README é recusada) e o token da câmera do simulador sai do segredo do servidor.

**Consequência.** Custo zero e link pronto em minutos. Em troca: o serviço dorme após 15 minutos sem visita (acorda em cerca de 1 minuto, com o salão zerado), o banco grátis expira em 30 dias e o servidor fica fora do Brasil. Por isso essa demonstração só recebe dados simulados. O primeiro cliente real vai para o servidor próprio com `infra/docker-compose.yml`.

## 14. Salão em 3D com three.js, sem trocar a planta

**Contexto.** Para a banca e para vender, o salão precisa impressionar no primeiro olhar e mostrar o que a câmera enxerga. A planta em grade continua sendo a forma mais rápida de ler o salão no celular no meio do serviço.

**Decisão.** Uma vista 3D a mais na tela Salão, com `three` 0.186, `@react-three/fiber` 9 (React) e `@react-three/drei` 10 (controles de órbita, linhas e iluminação de ambiente). Tudo é desenhado no código (móveis, pessoas sem rosto, piso de tábua), sem baixar modelo nem imagem. Os dados são os mesmos da planta, ao vivo pelo WebSocket. A placa de cada mesa é um botão comum da página, posicionado sobre a mesa a cada quadro: funciona com teclado, leitor de tela e testes. O 3D só é baixado quando alguém abre a vista 3D (~280 KB comprimidos). Computador abre em 3D, celular abre na planta; aparelho sem WebGL ou com erro volta sozinho para a planta.

**Consequência.** A demonstração ganha uma cena que explica o produto sem palavras, inclusive a parte de privacidade ("Ver como a câmera": formas e contornos, nenhum rosto). Em troca, três dependências a mais no painel e um teste de ponta a ponta que precisa de WebGL por software (`--enable-unsafe-swiftshader`) na CI.

## 15. Salão 3D realista: gente de verdade, sem filmar ninguém

**Contexto.** A maquete da decisão 14 (pessoas de cápsula, cores lisas) explicava o produto, mas não convencia na banca nem na venda: o dono de restaurante olha e vê um jogo, não o salão dele. Ao mesmo tempo, gente realista na tela pode passar a ideia de que a câmera filma e mostra os clientes, o que a GIRO nunca faz.

**Decisão.**
- **Pessoas da Microsoft Rocketbox (licença MIT desde 12/2020).** Foi a única biblioteca achada com adultos variados, roupas comuns, esqueleto e centenas de animações (sentar à mesa, andar, anotar) sob uma licença que deixa usar, mudar e redistribuir sem pagar. Escolhemos 6 clientes (3 mulheres, 3 homens, de cores de pele e roupas diferentes) e um garçom de camisa branca com avental.
- **Poses assadas para os clientes e esqueleto só no garçom.** Cliente sentado quase não se mexe: cada um vem com 3 poses já prontas (malha parada, sem ossos), escolhidas por (mesa, assento, hora em que sentou) para a mesma visita mostrar sempre as mesmas pessoas. Assim dá para desenhar todos os clientes de uma pose de uma vez (InstancedMesh), com ~5,6 mil triângulos cada. Só o garçom, que anda, tem esqueleto e clipes (parado, andando, anotando). Um pipeline só, o Blender, gera malha, esqueleto e poses: misturar ferramentas girava a pelve 90°.
- **Garçom que segue os dados.** Ele vai até a mesa de quem tocou "Vou atender" (ou que acabou de ser atendida), pelos corredores entre as mesas, na velocidade da passada do clipe, e volta ao balcão. Em aparelho fraco, ele aparece direto no destino.
- **Luz de ambiente local.** A foto 360° (Poly Haven, CC0) vem empacotada no painel por `@pmndrs/assets`, baixada só quando o 3D abre. O `preset` do drei buscaria a foto numa CDN de terceiros, o que quebra sem internet boa e manda o endereço do cliente para fora.
- **Efeitos por nível do aparelho.** Alto (placa de vídeo de verdade): oclusão de ambiente, brilho nas arandelas, sombra refeita a cada quadro, respiração sutil dos clientes. Médio (celular bom, placa integrada): sem oclusão, sombra só quando o salão muda. Baixo (celular fraco, computador sem aceleração, CI): sem pós-processamento e desenhando só quando algo muda. Se a imagem travar, o painel desce um nível sozinho.
- **Toalha xadrez, piso de tábua, lambri verde.** A cara de cantina de bairro, gerada no código (texturas PBR feitas na hora), sem arquivo de imagem no repositório.
- **Cuidado de LGPD.** O selo fixo "Pessoas ilustrativas: a câmera só conta, não filma ninguém." fica sempre no canto do 3D. Nenhuma imagem de câmera entra no 3D: as pessoas são desenho escolhido pelo painel a partir do número que a visão manda (quantos sentados por mesa). O modo "Ver como a câmera" continua mostrando só contornos.

**Consequência.** O salão fica com cara de restaurante e a história do produto aparece sozinha: cliente esperando, garçom indo, "Ver no salão" levando a câmera até a mesa do alerta. Em troca: ~2 MB de modelos baixados quando o 3D abre (do próprio painel), duas dependências de efeitos (`postprocessing`, `@react-three/postprocessing`) e a foto 360°, e um gerador (`infra/modelos-3d`) que precisa de Blender e fica fora da CI. O `three` fica preso abaixo de 0.187 até o `postprocessing` acompanhar (Dependabot ignora).
