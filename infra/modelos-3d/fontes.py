"""Refaz o fontes.txt (sha256, caminho e URL de cada download) a partir do config.json.

Uso (Python 3 comum, sem bpy), depois de mudar avatar, clipe ou decoração no config.json:
  python3 infra/modelos-3d/fontes.py <pasta_dl>
<pasta_dl> é a pasta de downloads do rascunho ($TRABALHO/dl do gerar.sh). O que já estiver
lá é usado como está; o que faltar é baixado. Confira o que mudou no fontes.txt antes de
juntar: o sha256 fixa a versão de cada arquivo.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

aqui = os.path.dirname(os.path.abspath(__file__))
dl = sys.argv[1]
config_path = os.path.join(aqui, "config.json")
saida = os.path.join(aqui, "fontes.txt")
config = json.loads(Path(config_path).read_text())
RB = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master"
KH = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models"
GRUPO = {"Business": "Professions", "Delivery": "Professions", "Security": "Professions"}

itens = [("rocketbox/LICENSE.md", f"{RB}/LICENSE.md"), ("rocketbox/README.md", f"{RB}/README.md")]


def avatar(nome: str) -> None:
    grupo = GRUPO.get(nome.split("_")[0], "Adults")
    base = f"{RB}/Assets/Avatars/{grupo}/{nome}"
    fbx = os.path.join(dl, "rocketbox", nome, f"{nome}.fbx")
    itens.append((f"rocketbox/{nome}/{nome}.fbx", f"{base}/Export/{nome}.fbx"))
    if not os.path.exists(fbx):
        baixar(itens[-1])
    texto = Path(fbx).read_bytes().decode("latin-1")
    prefixos = sorted(set(re.findall(r"([a-z]\d{3})_(?:body|head|opacity)_color\.tga", texto)))
    assert len(prefixos) == 1, (nome, prefixos)
    p = prefixos[0]
    for parte in ("body", "head", "opacity"):
        if f"{p}_{parte}_color.tga" in texto:
            itens.append(
                (
                    f"rocketbox/{nome}/{p}_{parte}_color.tga",
                    f"{base}/Textures/{p}_{parte}_color.tga",
                )
            )


def clipe(nome: str) -> None:
    pasta = (
        "all_animations_max_motextr_xy" if "walk" in nome else "all_animations_max_motextr_static"
    )
    itens.append((f"animacoes/{nome}.fbx", f"{RB}/Assets/Animations/{pasta}/{nome}.max.fbx"))


def baixar(item) -> None:
    destino, url = item
    caminho = os.path.join(dl, destino)
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    # lista fixa de URLs do próprio config (raw.githubusercontent.com)
    subprocess.run(["curl", "-sfL", "--retry", "3", "-o", caminho, url], check=True)  # noqa: S603, S607


for c in config["clientes"]:
    avatar(c["avatar"])
    for p in c["poses"]:
        clipe(p["clipe"])
avatar(config["garcom"]["avatar"])
for c in config["garcom"]["clipes"].values():
    clipe(c["arquivo"])
for d in config["decoracao"]:
    for arq, rel in (
        (f"{d['fonte']}.glb", f"glTF-Binary/{d['fonte']}.glb"),
        ("metadata.json", "metadata.json"),
        ("README.md", "README.md"),
    ):
        itens.append((f"khronos/{d['fonte']}/{arq}", f"{KH}/{d['fonte']}/{rel}"))

vistos = set()
linhas = [
    "# Lista fixa das fontes dos modelos 3D: sha256, caminho no rascunho e URL.",
    "# Gerada a partir do config.json; o gerar.sh baixa e confere cada uma.",
]
for destino, url in itens:
    if destino in vistos:
        continue
    vistos.add(destino)
    caminho = os.path.join(dl, destino)
    if not os.path.exists(caminho) or os.path.getsize(caminho) == 0:
        baixar((destino, url))
    soma = hashlib.sha256(Path(caminho).read_bytes()).hexdigest()
    linhas.append(f"{soma} {destino} {url}")
Path(saida).write_text("\n".join(linhas) + "\n")
print(len(vistos), "fontes")
