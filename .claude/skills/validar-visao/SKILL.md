---
name: validar-visao
description: Mede e calibra a visão computacional do GIRO com vídeo real de um salão (quantas pessoas sentadas e em pé por mesa) comparando com uma contagem feita à mão, e sugere a calibração da câmera. Use quando chegar vídeo ou acesso ao DVR de um restaurante, ao mexer em giro/visao/leitura.py ou no detector, quando a contagem estiver errada no painel, ou quando pedirem "calibra a câmera", "a visão está acertando?", "testa com esse vídeo".
---

# Validar e calibrar a visão

A regra de sentado e em pé (`giro/visao/leitura.py`) foi escrita sem vídeo real. Ela só vale para um salão depois de medida com vídeo daquele salão. Esta skill faz essa medição.

Todos os comandos rodam em `services/backend`, com as dependências da visão (`uv sync --all-extras`).

## 0. Privacidade antes de tudo

- O vídeo do restaurante fica **fora do repositório** (ex.: `~/videos-giro/`). Nunca copie quadro, print ou recorte com pessoas para dentro do repo: a trava de commit bloqueia e a LGPD proíbe.
- Só use vídeo com autorização escrita do dono do restaurante.
- Ao terminar, apague os quadros soltos que tiver extraído. O vídeo original é de quem enviou.

## 1. Desenho das mesas

Precisa do desenho de cada mesa sobre a imagem desta câmera, pontos de 0 a 1:

- Se a câmera já está no sistema, desenhe pela tela **Câmeras** do painel e copie de `GET /api/ingest/configuracao` (com o token da câmera) o campo `mesas`.
- Sem sistema, escreva à mão um `mesas.yaml` olhando um quadro do vídeo:
  ```yaml
  1: [[0.10, 0.20], [0.30, 0.20], [0.30, 0.45], [0.10, 0.45]]
  ```
  O desenho cobre a mesa **e as cadeiras**, como se visto de cima. Quem senta tem o meio da base da caixa dentro dele.

## 2. Primeira olhada (sem gabarito)

```bash
uv run python -m giro.visao.avaliar --fonte ~/videos-giro/salao.mp4 --mesas mesas.yaml
```

Mostra, a cada 10 s de vídeo, quantas pessoas sentadas (`s`) e em pé (`p`) a visão viu por mesa, e os eventos que o sistema geraria (sentou, atendida, saiu...). Compare com o vídeo nos mesmos instantes. Erros comuns:

| Sintoma | Causa provável | O que mexer |
|---|---|---|
| Garçom contado como sentado | Câmera alta, gente em pé fica "baixa" na imagem | Diminuir `proporcao_em_pe` |
| Cliente contado como em pé | Câmera baixa ou cliente de lado | Aumentar `proporcao_em_pe` |
| Cliente da mesa vizinha entra na conta | Desenho grande demais | Redesenhar a mesa menor |
| Garçom não aparece no atendimento | Ele fica longe da mesa | Aumentar `margem_atendimento` |
| Sombra ou casaco na cadeira contado como pessoa | Detecção fraca passando | Aumentar `confianca_minima` |
| Pessoa escondida atrás de outra some | Limite da câmera | Não tem ajuste: anote no relatório |

## 3. Gabarito e medição

Escreva `gabarito.yaml` contando à mão, olhando o vídeo, pelo menos 20 instantes que cubram mesa vazia, cliente esperando, garçom atendendo e mesa saindo:

```yaml
"0:00": {1: [0, 0], 2: [2, 0]}   # mesa: [sentados, em pé]
"0:10": {1: [3, 1], 2: [2, 0]}
```

```bash
uv run python -m giro.visao.avaliar --fonte ~/videos-giro/salao.mp4 --mesas mesas.yaml \
    --gabarito gabarito.yaml --varrer
```

`--varrer` testa `proporcao_em_pe` de 1,4 a 3,4. Escolha o valor que maximiza **mesa ocupada** primeiro (é o que dispara os alertas), depois **garçom junto à mesa** (é o que encerra o alerta de atendimento). Teste também `--margem 0.03` e `--margem 0.08`. Para comparar modelos: `--modelo yolox_tiny`.

Metas para colocar num cliente pagante: ocupada ≥ 95%, garçom ≥ 85%. Abaixo disso, o alerta vai errar na frente do dono.

## 4. Aplicar

- Calibração por câmera: na tela **Câmeras** do painel, seção Calibração (dono ou equipe GIRO), ou `PATCH /api/cameras/{id}` com `ajustes_visao`.
- Mudar o padrão para todos os restaurantes (`Ajustes` em `giro/visao/leitura.py`) só com medição em pelo menos dois salões diferentes. Atualize os testes de `tests/test_visao.py` e explique o motivo no commit.

## 5. Relatório

Responda com: salão e câmera, duração do vídeo, número de comparações, acerto antes e depois (ocupada, sentados, garçom), valores escolhidos e por quê, e os casos que nenhum ajuste resolve (ex.: mesa atrás de pilar). Registre a decisão em `docs/decisoes.md` se mudou o padrão.
