---
name: simular-salao
description: Roda os cenários do simulador de salão do GIRO para testar ou demonstrar a máquina de estados das mesas e os alertas (cliente sem atendimento, mesa vaga). Use ao mudar qualquer regra da mesa, ao criar um cenário novo, ao preparar uma demonstração ao vivo para cliente ou banca, ou quando pedirem "simula uma sexta lotada", "testa o alerta", "roda os cenários".
---

# Simular o salão

O simulador faz o papel da câmera: manda, a cada 10 segundos, quantas pessoas estão sentadas e em pé em cada mesa. Ele fica em `services/backend/giro/simulador/` e os cenários em `services/backend/giro/simulador/cenarios/*.yaml`.

Todos os comandos rodam em `services/backend`.

## 1. Conferir os cenários (sem API, sem esperar o relógio)

```bash
uv run python -m giro.simulador verificar             # todos
uv run python -m giro.simulador verificar mesa-suja   # um só
uv run python -m giro.simulador verificar --detalhes  # mostra tudo que aconteceu
```

Cada cenário diz o que deve acontecer (`esperado`). A verificação é estrita: tudo o que era esperado tem que acontecer na hora certa (tolerância padrão de 10s) e nada além disso pode acontecer. Os mesmos cenários rodam no `pytest` (`tests/test_simulador.py`).

Se um cenário falhar depois de mudar a regra da mesa:
1. Leia a falha ("faltou" ou "inesperado") e rode com `--detalhes`.
2. Decida se a regra nova está errada ou se o cenário precisa mudar. Mudar o cenário só para passar é proibido: se a regra mudou de propósito, explique no commit por que o comportamento esperado mudou.

## 2. Criar um cenário novo

Crie `cenarios/<nome-com-hifen>.yaml`:

```yaml
descricao: >
  Uma frase dizendo a situação real do restaurante que o cenário reproduz.

linha_do_tempo:            # cada linha muda o que a câmera vê numa mesa, a partir daquele tempo
  - {em: "0:00", mesa: 4, sentados: 3}
  - {em: "2:00", mesa: 4, em_pe: 1}        # garçom chegou
  - {em: "2:40", mesa: 4, em_pe: 0}
  - {em: "40:00", mesa: 4, sentados: 0}    # foram embora
  - {em: "45:00", mesa: 4, acao: liberar}  # equipe tocou em "Liberar mesa"

esperado:
  - {em: "0:00", mesa: 4, tipo: sentou}
  - {em: "2:00", mesa: 4, tipo: atendida}
  - {em: "40:00", mesa: 4, tipo: saiu}
  - {em: "41:00", mesa: 4, tipo: alerta_mesa_vaga}
  - {em: "45:00", mesa: 4, tipo: liberada}
```

Tipos de evento: `sentou`, `atendida`, `saiu`, `saiu_sem_atendimento`, `liberada`, `alerta_sem_atendimento`, `alerta_mesa_vaga`.

Regras de tempo (padrão, em `giro/dominio/mesa.py`): ocupação confirma depois de 20s vendo gente sentada (o evento leva a hora em que sentaram), saída confirma depois de 1 min vazia (o evento leva a hora em que esvaziou), alerta de atendimento aos 5 min, alerta de mesa vaga junto da confirmação da saída.

Rode `verificar <nome>` e depois `uv run pytest tests/test_simulador.py -q`.

## 3. Demonstração ao vivo no painel

Precisa da API e do painel rodando (`make dev` na raiz, ou veja o README) e dos dados de demonstração (`uv run python -m giro.seed`).

```bash
# Cenário pronto, começando no meio para o primeiro alerta aparecer em ~30s:
uv run python -m giro.simulador ao-vivo --cenario sexta-lotada --inicio-em 4:30

# Noite aleatória nas 14 mesas da Cantina do Marcos, em ritmo rápido de demonstração:
uv run python -m giro.simulador ao-vivo --aleatorio --ritmo demo --mesas 1-14 --repetir
```

Entre no painel com `gerente@cantina.demo` / `giro1234`. No modo ao vivo o simulador não executa `acao: liberar`: ele avisa no terminal a hora de alguém tocar em "Liberar mesa" no painel. Isso faz parte da demonstração.

## Ao terminar

Diga quantos cenários passaram, quais falharam e por quê, e se algum cenário foi criado ou alterado.
