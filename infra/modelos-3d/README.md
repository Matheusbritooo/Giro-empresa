# Modelos 3D do salão (pessoas e decoração)

Esta pasta gera os arquivos de `apps/web/public/modelos/` que o salão 3D do painel usa:

| Arquivo | O que é |
|---|---|
| `pessoas/cliente-<id>.glb` | 6 clientes adultos (3 mulheres, 3 homens). Cada arquivo tem 3 malhas **estáticas** (pose já assada, sem esqueleto): `pose_0` sentado parado, `pose_1` sentado conversando, `pose_2` uma terceira pose sentada. As três usam os mesmos materiais (`corpo`, `cabeca`, `cabelo`). |
| `pessoas/garcom.glb` | Garçom **com esqueleto** (80 ossos) e 3 clipes: `parado`, `andando` (no lugar, sem mover a raiz, em laço) e `anotando`. Camisa branca, calça escura e avental escuro feito aqui. |
| `decoracao/*.glb` | Planta, arandela, vaso com flores e geladeira de bebidas (modelos de exemplo do Khronos). |
| `manifesto.json` | Lista do que existe, com triângulos, bytes, duração dos clipes e velocidade da caminhada. |
| `CREDITOS.md`, `LICENSE-Rocketbox.md` | Licença e autoria de cada ativo. |

Nada disso roda na CI. Os arquivos prontos ficam no repositório; esta pasta só existe para dar
para refazer tudo do zero, do mesmo jeito.

## Referencial (o mesmo do `planta.ts` do painel)

Metro, y para cima, pessoa olhando **+z**.

- **Clientes**: origem no centro do assento da cadeira projetado no chão. Assento com topo em
  0,477 m, encosto em z = -0,19, borda da mesa em z = +0,34, tampo em y = 0,75. Basta pôr a malha
  dentro do grupo da cadeira. Cada malha leva nos `extras` (no three.js, `userData`) os pontos
  `pelve`, `cabeca_topo`, `joelho_L/R` e `mao_L/R` e o `papel` da pose.
- **Garçom**: pés em y = 0, olhando +z, centrado em x = z = 0. Para andar, toque `andando` e mova o
  objeto na velocidade do `manifesto.json` (`garcom.velocidade`, m/s): é a velocidade em que o pé
  de apoio fica parado no chão.

Faixas conferidas em cada pose de cliente (o script para com erro se sair delas):

| Medida | Faixa |
|---|---|
| pelve (y) | 0,50 a 0,64 m |
| topo da cabeça (y) | 1,22 a 1,42 m |
| joelhos | z ≥ 0,22 e y < 0,70 (debaixo do tampo) |
| mãos (centro) | y de 0,76 a 0,95 e z de 0,22 a 0,58 (sobre a mesa) |
| tampo | nenhum ponto da pessoa dentro da laje do tampo |
| encosto | nenhum ponto das costas atrás da face do encosto |
| pés | y ≥ -0,01 |

## Como gerar de novo

Requisitos:

- Python **3.13** com **bpy 5.2.2** (o Blender como módulo do Python):
  ```bash
  python3.13 -m venv /caminho/venv-bpy
  /caminho/venv-bpy/bin/pip install bpy==5.2.2
  ```
- Node 20+ com npm. As ferramentas (`@gltf-transform/cli` 4.5.1, `meshoptimizer` 1.2.0 e
  `sharp` 0.35.5) têm versão fixa em `node/package-lock.json`, e o `gerar.sh` instala numa pasta
  de rascunho com `npm ci --ignore-scripts` (nenhum pacote roda script ao instalar).
- Acesso a `raw.githubusercontent.com` (Rocketbox e Khronos) e ao registry do npm.

```bash
BPY_PYTHON=/caminho/venv-bpy/bin/python infra/modelos-3d/gerar.sh
```

Leva uns 2 minutos (baixa cerca de 300 MB na primeira vez) e, com as mesmas versões, sai byte a
byte igual ao que está no repositório. Variáveis opcionais: `TRABALHO` (rascunho, padrão
uma pasta nova do `mktemp`; passe uma pasta fixa para não baixar tudo de novo) e `DESTINO` (padrão
`apps/web/public/modelos`). Os downloads ficam no rascunho e nunca entram no repositório.

## O que o `gerar.sh` faz

1. **Downloads** da lista fixa `fontes.txt` (URL e sha256 de cada arquivo). Se a origem mudar, o
   script para.
2. **Blender** (`blender/`), um pipeline só para malha, esqueleto e poses:
   - `comum.py`: importa o FBX do avatar, troca os materiais por `corpo`/`cabeca`/`cabelo`,
     copia um clipe para o avatar **em espaço de mundo** (cada osso copia a rotação de mundo do
     osso de mesmo nome do clipe). O FBX do clipe não tem pose de ligação, então trocar só a
     ação girava a pelve 90°; copiando em mundo isso não acontece.
   - `clientes.py` + `sentado.py`: para cada pose do `config.json`, vai ao quadro escolhido,
     congela, encaixa na cadeira (fundo do quadril no assento, pelve em `pelve_z`, costas fora do
     encosto), baixa os joelhos até o pé encostar no chão, mede e assa a malha sem esqueleto.
   - `garcom.py` + `avental.py`: escala o garçom, cria o avental com pele (pelve e coxas), copia
     os três clipes, procura a janela do clipe que fecha o laço com a menor diferença, funde o
     fim no começo, tira o deslocamento da caminhada, assa as ações e mede pés, frente e
     velocidade.
3. **Otimização** (`node/otimizar.mjs`): texturas WebP 512 px, cabelo `MASK`, simplificação com o
   meshoptimizer até ~5,5 mil triângulos por pose (ele não junta vértices através das costuras de
   UV, então a textura não rasga; o cabelo não é simplificado), compressão meshopt.
4. **Manifesto e conferência** (`node/manifesto.mjs`, `node/validar.mjs`): tamanhos (cliente até
   700 KB, os 6 até 3,5 MB, garçom até 900 KB, decoração até 700 KB cada, pasta até 6 MB), nomes
   das malhas e dos clipes, materiais, extensões e os pontos de referência nos `extras`.

Para olhar um arquivo: `node node/inspecionar.mjs arquivo.glb` (depois do `npm ci` em `node/`).

## Trocar uma pessoa ou uma pose

No `config.json`, cada cliente tem `avatar` (pasta do Rocketbox), `altura` em pé, `pelve_z` e `dy`
(ajuste fino do encaixe na cadeira) e 3 poses com `clipe` (do mesmo gênero do avatar, `f_` ou
`m_`) e `quadro`; cada pose também aceita `pelve_z` e `dy` próprios. Depois refaça a lista de
downloads com `python3 infra/modelos-3d/fontes.py $TRABALHO/dl` (baixa o que faltar e grava o
sha256 no `fontes.txt`) e rode o `gerar.sh`.
Se uma pose sair das faixas, o Blender diz qual medida falhou: mude o quadro, o `pelve_z` ou o
`dy`, ou troque o clipe.

## Licenças

- Avatares e animações: **Microsoft Rocketbox**, licença MIT desde 12/2020 (cópia em
  `apps/web/public/modelos/LICENSE-Rocketbox.md`).
- Decoração: modelos de exemplo do **Khronos glTF-Sample-Assets**, CC0 1.0 ou CC BY 4.0 conforme
  o `metadata.json` de cada um. Autoria e dono em `apps/web/public/modelos/CREDITOS.md`.
