# Créditos dos modelos 3D

Todos os arquivos desta pasta foram gerados por `infra/modelos-3d/gerar.sh` a partir das fontes
abaixo (convertidos, com pose assada ou clipes recortados, texturas reduzidas para WebP 512 px,
malhas simplificadas e comprimidas com meshopt). Licença e autoria conferidas no `LICENSE.md` e no
`README.md` do Rocketbox e no `metadata.json` de cada modelo do Khronos.

## Pessoas: Microsoft Rocketbox Avatar Library

- Fonte: https://github.com/microsoft/Microsoft-Rocketbox (avatares em `Assets/Avatars`,
  animações em `Assets/Animations`).
- Licença: **MIT**, desde 12/2020. Copyright (c) 2020 Microsoft. Texto completo em
  [`LICENSE-Rocketbox.md`](./LICENSE-Rocketbox.md).
- Criação original dos avatares: equipe Rocketbox (Markus Wojcik); biblioteca publicada pela
  Microsoft Research (Mar Gonzalez-Franco e outros). Artigo: Gonzalez-Franco et al., "The Rocketbox
  library and the utility of freely available rigged avatars", Frontiers in Virtual Reality,
  2020, DOI 10.3389/frvir.2020.561558.
- Mudanças feitas aqui: escala para altura brasileira, poses sentadas assadas a partir das
  animações `sit_table_*`, clipes do garçom recortados em laço, avental acrescentado no garçom,
  materiais simplificados, malhas simplificadas.

| Arquivo | Avatar do Rocketbox | Animações usadas |
|---|---|---|
| `pessoas/cliente-ana.glb` | `Adults/Female_Adult_01` | `f_sit_table_*` |
| `pessoas/cliente-yumi.glb` | `Adults/Female_Adult_03` | `f_sit_table_*` |
| `pessoas/cliente-luiza.glb` | `Adults/Female_Adult_11` | `f_sit_table_*` |
| `pessoas/cliente-pedro.glb` | `Adults/Male_Adult_06` | `m_sit_table_*` |
| `pessoas/cliente-jorge.glb` | `Adults/Male_Adult_12` | `m_sit_table_*` |
| `pessoas/cliente-ravi.glb` | `Adults/Male_Adult_17` | `m_sit_table_*` |
| `pessoas/garcom.glb` | `Professions/Business_Male_06` | `m_idle_neutral_01`, `m_walk_neutral_01`, `m_documents_note` |

## Decoração: Khronos glTF-Sample-Assets

Fonte: https://github.com/KhronosGroup/glTF-Sample-Assets (pasta `Models/<nome>`).

| Arquivo | Modelo | Licença | Dono | Artista |
|---|---|---|---|---|
| `decoracao/planta.glb` | DiffuseTransmissionPlant | CC BY 4.0 (materiais e animação, 2024) e CC0 1.0 (modelo original, 2021) | Darmstadt Graphics Group GmbH; modelo original em domínio público | Eric Chadwick; modelo original de Rico Cilliers |
| `decoracao/arandela.glb` | AnisotropyBarnLamp | CC BY 4.0 (2023) | Copyright 2023 Wayfair, LLC | Eric Chadwick |
| `decoracao/vaso-flores.glb` | GlassVaseFlowers | CC0 1.0 (2023) | Público | Eric Chadwick (vaso), Rico Cilliers (flores) |
| `decoracao/geladeira.glb` | CommercialRefrigerator | CC BY 4.0 (2025) | Darmstadt Graphics Group GmbH; baseado em "Commercial Fridge" de Sean Thomas (CC BY 4.0, https://sketchfab.com/3d-models/commercial-fridge-2174e1e4f1f24f1a95aa110ee060f473) | Eric Chadwick; Sean Thomas |

Mudanças feitas aqui: na planta saíram os vagalumes, as luzes e a animação; no vaso ficou um vaso
só (o de vidro com transparência simples); na geladeira saiu a animação da porta; texturas em
WebP 512 px e malhas simplificadas.

CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ · CC0 1.0:
https://creativecommons.org/publicdomain/zero/1.0/
