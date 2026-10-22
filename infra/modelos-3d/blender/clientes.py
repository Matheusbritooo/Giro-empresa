"""Clientes sentados: um GLB por avatar com 3 malhas estáticas (pose_0, pose_1, pose_2).

Uso (bpy 5.2.2, Python 3.13):
  python -I blender/clientes.py -- <config.json> <pasta_downloads> <pasta_saida> [id...]

Para cada cliente do config.json:
  1. Importa o avatar do Rocketbox, troca os materiais por corpo/cabeca/cabelo (os mesmos
     para as três poses) e escala para a altura brasileira do config.
  2. Para cada pose: liga o avatar ao clipe (comum.ligar), vai ao quadro escolhido,
     congela a pose, encaixa na cadeira (sentado.encaixe), baixa os joelhos até o pé
     encostar no chão (sentado.apoiar_pes) e assa a malha deformada, sem esqueleto.
  3. Mede cada pose no referencial da cadeira e para com erro se alguma medida sair da
     faixa (sentado.LIMITES). As medidas vão para <pasta_saida>/<id>.json.
Saída: <pasta_saida>/<id>.glb (ainda sem otimizar; o node/otimizar.mjs faz o resto).
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import comum  # noqa: E402
import sentado  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
config_path, downloads, saida = args[:3]
so = set(args[3:])
with open(config_path) as f:
    clientes = json.load(f)["clientes"]
os.makedirs(saida, exist_ok=True)

falhas = []
for cliente in clientes:
    if so and cliente["id"] not in so:
        continue
    comum.limpar()
    nome = cliente["avatar"]
    arm, malhas = comum.importar_avatar(os.path.join(downloads, "rocketbox", nome), nome)
    comum.aplicar_transformacoes(arm)
    pts, _ = comum.malha_avaliada(malhas)
    altura_original = max(p.z for p in pts) - min(p.z for p in pts)
    escala = cliente["altura"] / altura_original
    medidas = {
        "id": cliente["id"],
        "avatar": nome,
        "sexo": cliente["sexo"],
        "altura_em_pe_m": cliente["altura"],
        "escala": round(escala, 4),
        "poses": [],
    }
    assadas = []
    for i, pose in enumerate(cliente["poses"]):
        clip, ajuste, _ = comum.importar_clipe(
            os.path.join(downloads, "animacoes", f"{pose['clipe']}.fbx")
        )
        sentado.zerar_pose(arm)
        comum.ligar(arm, clip)
        comum.ir_para(pose["quadro"])
        sentado.congelar(arm)
        ajustes = {
            "escala": escala,
            "pelve_z": pose.get("pelve_z", cliente.get("pelve_z", -0.02)),
            "dy": pose.get("dy", cliente.get("dy", 0.0)),
            "giro": pose.get("giro", 0.0),
            "inclinacao": pose.get("inclinacao", 0.0),
        }
        m = sentado.encaixe(arm, malhas, **ajustes)
        joelhos = {"L": 0.0, "R": 0.0}
        for _ in range(2):
            g = sentado.apoiar_pes(arm, malhas, m)
            joelhos = {k: joelhos[k] + g[k] for k in g}
            m = sentado.encaixe(arm, malhas, **ajustes)
        med = sentado.medir(arm, malhas, m)
        erros = sentado.conferir(med)
        med.update(
            {
                "nome": f"pose_{i}",
                "papel": pose["papel"],
                "clipe": pose["clipe"],
                "quadro": pose["quadro"],
                "coxa_graus": {k: round(v, 2) for k, v in joelhos.items()},
                "ajustes": {k: round(v, 4) for k, v in ajustes.items() if k != "escala"},
                "erros": erros,
            }
        )
        medidas["poses"].append(med)
        print(f"POSE {cliente['id']} pose_{i} {pose['clipe']}@{pose['quadro']}: {erros or 'OK'}")
        if erros:
            falhas.append(f"{cliente['id']} pose_{i}: {'; '.join(erros)}")
        ob = comum.assar(malhas, f"pose_{i}")
        comum.transformar(ob, m)
        # vai para node.extras do glTF (userData no three.js)
        ob["papel"] = pose["papel"]
        for chave, ponto in med["pontos"].items():
            ob[chave] = ponto
        assadas.append(ob)
        comum.remover_clipe(clip, ajuste)
    # Só as poses assadas vão para o arquivo: sem esqueleto, sem pele.
    for o in [arm, *malhas]:
        bpy.data.objects.remove(o, do_unlink=True)
    comum.exportar_glb(os.path.join(saida, f"{cliente['id']}.glb"), assadas)
    with open(os.path.join(saida, f"{cliente['id']}.json"), "w") as f:
        json.dump(medidas, f, indent=2, ensure_ascii=False)

if falhas:
    print("FALHOU", *falhas, sep="\n  ")
    sys.exit(1)
print("CLIENTES OK")
