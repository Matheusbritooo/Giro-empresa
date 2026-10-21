---
name: checagem-lgpd
description: Checklist de privacidade (LGPD) e isolamento entre restaurantes do GIRO, para rodar antes de juntar qualquer mudança na main. Use quando terminar uma tarefa que mexe em câmera, imagem, banco, log, API, autenticação, push ou dados de cliente, antes de abrir ou aprovar um PR, ou quando pedirem "checa LGPD", "isso está seguro?", "pode subir?".
---

# Checagem de LGPD e isolamento

O GIRO trata imagem de pessoas dentro de restaurantes. O TCM (seção 1.9) assumiu compromissos que o código precisa cumprir. Esta checagem confere a mudança contra eles.

## 1. Pegue a mudança

```bash
git diff main...HEAD --stat
git diff main...HEAD
```

Se não houver branch, use `git diff` e `git diff --cached`.

## 2. Rode a trava automática

```bash
scripts/verificar-commit.sh --todos
```

Ela bloqueia `.env`, chaves privadas, arquivos grandes e imagens ou vídeos fora de `apps/web/public/icone*` e `docs/telas/`.

## 3. Confira item por item

Para cada item, responda **ok**, **não se aplica** ou **problema** (com arquivo e linha).

**Imagem**
- [ ] Nenhuma imagem ou quadro de câmera é gravado em disco, banco, log, fila persistente ou storage. Quadro é analisado em memória e descartado.
- [ ] Nada de reconhecimento facial, comparação de rostos, idade, gênero, roupa ou qualquer coisa que identifique quem é a pessoa. O sistema só conta pessoas por mesa.
- [ ] A rota `/api/ingest/observacoes` continua recebendo só números (sentados, em pé), nunca imagem.
- [ ] Se algum dia guardarmos a foto do salão vazio para desenhar as mesas (Fase 2), as pessoas precisam estar borradas antes de gravar.

**Isolamento entre restaurantes**
- [ ] Toda tabela nova com dado de cliente tem `restaurante_id`.
- [ ] Toda rota nova filtra pelo restaurante do usuário (`RestauranteAlvo` ou `restaurante_permitido` em `giro/api/deps.py`). Busca por id (`db.get`) é seguida de `restaurante_permitido`.
- [ ] Tem teste provando que um restaurante não lê nem altera dado do outro (veja `tests/test_api_acesso.py`).
- [ ] Mensagens ao vivo (`central.publicar`) vão só para o `restaurante_id` dono do dado.

**Dados pessoais e segredos**
- [ ] Logs não têm senha, token, cookie, e-mail de cliente final nem conteúdo de imagem.
- [ ] Senha só como hash (argon2, `giro/seguranca.py`). Token de câmera só como hash.
- [ ] Sessão continua em cookie `HttpOnly`, `SameSite=Lax`, e `Secure` em produção.
- [ ] Endereço de push continua restrito aos serviços dos navegadores (`HOSTS_PUSH` em `giro/esquemas.py`).
- [ ] Nenhuma chamada nova para serviço externo envia dado de cliente sem estar descrito no README.

**Perfis**
- [ ] Ação nova respeita os perfis: equipe só vê o salão e libera mesa; gerente também cadastra mesas; dono também gere equipe, câmeras e ajustes; admin GIRO precisa escolher o restaurante.

## 4. Para revisão mais funda

Chame o agente `guardiao-lgpd` com o diff. Ele só lê e aponta, não altera nada.

## 5. Resultado

Responda com a lista acima preenchida e um veredito: **pode juntar** ou **precisa corrigir** (com o que corrigir). Problema de isolamento ou de imagem gravada é sempre bloqueante.
