"""Encaixe e medidas de uma pessoa sentada no referencial da cadeira do salão 3D.

Referencial (glTF, metro): origem no centro do assento projetado no chão, pessoa olhando
+z, assento com topo em 0,477 m, encosto em z = -0,19 (face da frente em -0,174), borda
da mesa em z = +0,34 e tampo em y = 0,75 (planta.ts e geometrias.ts do painel).
"""

from __future__ import annotations

import math

import bpy
from comum import frente, gltf, malha_avaliada, osso_mundo
from mathutils import Matrix, Vector

TOPO_ASSENTO = 0.477
BORDA_MESA = 0.34
TAMPO = 0.75
FACE_ENCOSTO = -0.174

# Faixas que cada pose precisa cumprir (glTF, metro).
LIMITES = {
    "pelve_y": (0.50, 0.64),
    "cabeca_topo_y": (1.22, 1.42),
    "joelho_z_min": 0.22,
    "joelho_y_max": 0.70,
    "mao_y": (0.76, 0.95),
    "mao_z": (0.22, 0.58),
    "pe_y_min": -0.01,
}


def _lado(osso: str) -> str | None:
    if " L " in osso:
        return "L"
    if " R " in osso:
        return "R"
    return None


def _posicionar(pontos, ossos, pelve, m: Matrix, pelve_z: float, dy: float) -> Matrix:
    """Completa `m`: quadril no assento, pelve em x = 0 e z = pelve_z, costas fora do encosto."""
    p = m @ pelve
    # Fundo do quadril: o ponto mais baixo da pelve e do começo das coxas, perto da pelve.
    fundo = min(
        (m @ v).z
        for v, o in zip(pontos, ossos, strict=True)
        if (o in ("Bip01 Pelvis", "Bip01 Spine") or o.endswith("Thigh"))
        and -0.06 < (m @ v).y - p.y < 0.12  # do quadril para trás (a frente é -y)
    )
    m = Matrix.Translation(Vector((-p.x, -pelve_z - p.y, TOPO_ASSENTO + dy - fundo))) @ m
    # Costas: o ponto do tronco mais para trás não passa da face do encosto (glTF z = -y).
    costas = max(
        (m @ v).y
        for v, o in zip(pontos, ossos, strict=True)
        if TOPO_ASSENTO + 0.03 < (m @ v).z < 0.97 and abs((m @ v).x) < 0.21
    )
    if -costas < FACE_ENCOSTO:
        m = Matrix.Translation(Vector((0, -FACE_ENCOSTO - costas, 0))) @ m
    return m


def encaixe(
    arm,
    malhas,
    escala: float = 1.0,
    pelve_z: float = -0.02,
    dy: float = 0.0,
    giro: float = 0.0,
    inclinacao: float = 0.0,
) -> Matrix:
    """Matriz (Blender) que põe a pose atual sentada na cadeira.

    Em volta da pelve: escala a pessoa (`escala`), gira para olhar -y do Blender (+z do
    glTF; `giro` soma graus) e inclina o corpo inteiro para a frente (`inclinacao`, graus).
    Depois apoia o fundo do quadril no assento (+dy), centra a pelve em x, põe a pelve em
    z = pelve_z (glTF) e não deixa as costas entrarem no encosto.
    """
    f = frente(arm)
    ang = math.atan2(f.x, -f.y)  # quanto falta para f virar (0, -1)
    pelve = osso_mundo(arm, "Bip01 Pelvis")
    pontos, ossos = malha_avaliada(malhas)
    base = (
        Matrix.Translation(pelve)
        @ Matrix.Rotation(math.radians(inclinacao), 4, "X")
        @ Matrix.Rotation(ang + math.radians(giro), 4, "Z")
        @ Matrix.Scale(escala, 4)
        @ Matrix.Translation(-pelve)
    )
    return _posicionar(pontos, ossos, pelve, base, pelve_z, dy)


def _altura_pe(malhas, m: Matrix, lado: str) -> float:
    pontos, ossos = malha_avaliada(malhas)
    return min(
        (m @ v).z
        for v, o in zip(pontos, ossos, strict=True)
        if _lado(o) == lado and ("Foot" in o or "Toe" in o or "Calf" in o)
    )


def apoiar_pes(arm, malhas, m: Matrix, alvo: float = 0.0, limite: float = 15.0) -> dict[str, float]:
    """Gira cada coxa em volta do quadril (para cima ou para baixo) até a sola encostar no chão.

    A escala que deixa a pessoa do tamanho brasileiro encurta as pernas e o pé fica no
    ar. Baixar um pouco o joelho resolve sem mexer no quadril, no tronco nem nas mãos
    (gente sentada de verdade fica com o joelho um pouco abaixo do quadril). Precisa da
    pose congelada (sem restrições). Devolve os graus usados por lado.
    """
    usados = {}
    for lado in "LR":
        coxa = arm.pose.bones[f"Bip01 {lado} Thigh"]
        quadril = coxa.head.copy()
        direcao = coxa.tail - coxa.head
        eixo = direcao.cross(Vector((0.0, 0.0, 1.0)))
        if eixo.length < 1e-6:
            usados[lado] = 0.0
            continue
        eixo.normalize()
        original = coxa.matrix.copy()

        def girar(
            graus: float, original=original, coxa=coxa, quadril=quadril, eixo=eixo, lado=lado
        ) -> float:
            coxa.matrix = (
                Matrix.Translation(quadril)
                @ Matrix.Rotation(math.radians(graus), 4, eixo)
                @ Matrix.Translation(-quadril)
                @ original
            )
            bpy.context.view_layer.update()
            return _altura_pe(malhas, m, lado)

        h0 = girar(0.0)
        if abs(h0 - alvo) < 0.003:
            usados[lado] = 0.0
            continue
        # sentido que abaixa o pé quando ele está no ar (ou levanta, se afundou)
        sinal = 1.0 if (girar(2.0) < h0) == (h0 > alvo) else -1.0
        a, b = 0.0, limite * sinal
        if (girar(b) - alvo) * (h0 - alvo) > 0:  # nem no limite resolve: fica no limite
            usados[lado] = round(b, 2)
            continue
        for _ in range(16):
            meio = (a + b) / 2
            if (girar(meio) - alvo) * (h0 - alvo) > 0:
                a = meio
            else:
                b = meio
        girar(b)
        usados[lado] = round(b, 2)
    return usados


def congelar(arm) -> None:
    """Passa a pose vista (com as restrições do clipe) para a própria pose e tira as restrições."""
    ordem = []

    def visitar(osso):
        ordem.append(osso.name)
        for f in osso.children:
            visitar(f)

    for raiz in [b for b in arm.data.bones if b.parent is None]:
        visitar(raiz)
    vistas = {n: arm.pose.bones[n].matrix.copy() for n in ordem}
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
    for n in ordem:
        arm.pose.bones[n].matrix = vistas[n]
        bpy.context.view_layer.update()


def zerar_pose(arm) -> None:
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def medir(arm, malhas, m: Matrix) -> dict:
    """Medidas da pose com a matriz de encaixe `m`, no referencial glTF."""
    pontos, ossos = malha_avaliada(malhas)
    pts = [gltf(m @ v) for v in pontos]
    pelve = gltf(m @ osso_mundo(arm, "Bip01 Pelvis"))
    med = {"pelve_y": pelve[1], "pelve_z": pelve[2]}

    def v3(p):
        return [round(c, 3) for c in p]

    # Pontos de referência (glTF), gravados nos extras de cada pose para quem usa o modelo.
    pontos_ref = {"pelve": v3(pelve)}
    cabeca = [p for p, o in zip(pts, ossos, strict=True) if o in ("Bip01 Head", "Bip01 Neck")]
    topo = max(cabeca, key=lambda p: p[1])
    med["cabeca_topo_y"] = topo[1]
    pontos_ref["cabeca_topo"] = v3(topo)
    for lado in "LR":
        j = gltf(m @ osso_mundo(arm, f"Bip01 {lado} Calf"))
        med[f"joelho_{lado}"] = (round(j[1], 3), round(j[2], 3))
        pontos_ref[f"joelho_{lado}"] = v3(j)
        mao = [
            p
            for p, o in zip(pts, ossos, strict=True)
            if _lado(o) == lado and ("Hand" in o or "Finger" in o)
        ]
        cy = sum(p[1] for p in mao) / len(mao)
        cz = sum(p[2] for p in mao) / len(mao)
        med[f"mao_{lado}"] = (round(cy, 3), round(cz, 3))
        pontos_ref[f"mao_{lado}"] = v3((sum(p[0] for p in mao) / len(mao), cy, cz))
        med[f"mao_{lado}_y_min"] = round(min(p[1] for p in mao), 3)
    med["pe_y_min"] = min(p[1] for p in pts)
    # Atravessando o tampo: pontos dentro da laje do tampo (4 cm) sobre a mesa.
    med["no_tampo"] = sum(
        1 for p in pts if BORDA_MESA + 0.005 < p[2] < 1.0 and TAMPO - 0.045 < p[1] < TAMPO - 0.002
    )
    # Entrando no encosto ou no assento.
    med["no_encosto"] = sum(
        1 for p in pts if p[2] < FACE_ENCOSTO - 0.01 and 0.5 < p[1] < 0.95 and abs(p[0]) < 0.2
    )
    med["no_assento"] = sum(
        1
        for p in pts
        if abs(p[0]) < 0.2
        and -0.2 < p[2] < 0.2
        and TOPO_ASSENTO - 0.04 < p[1] < TOPO_ASSENTO - 0.012
    )
    med["altura_total"] = max(p[1] for p in pts) - min(p[1] for p in pts)
    med = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in med.items()}
    med["pontos"] = pontos_ref
    return med


def conferir(med: dict) -> list[str]:
    """Lista do que ficou fora das faixas (vazia = pose aprovada)."""
    erros = []
    a, b = LIMITES["pelve_y"]
    if not a <= med["pelve_y"] <= b:
        erros.append(f"pelve y {med['pelve_y']}")
    a, b = LIMITES["cabeca_topo_y"]
    if not a <= med["cabeca_topo_y"] <= b:
        erros.append(f"cabeça {med['cabeca_topo_y']}")
    for lado in "LR":
        jy, jz = med[f"joelho_{lado}"]
        if jz < LIMITES["joelho_z_min"] or jy >= LIMITES["joelho_y_max"]:
            erros.append(f"joelho {lado} y={jy} z={jz}")
        my, mz = med[f"mao_{lado}"]
        a, b = LIMITES["mao_y"]
        c, d = LIMITES["mao_z"]
        if not (a <= my <= b and c <= mz <= d):
            erros.append(f"mão {lado} y={my} z={mz}")
    if med["pe_y_min"] < LIMITES["pe_y_min"]:
        erros.append(f"pé {med['pe_y_min']}")
    if med["no_tampo"] > 0:
        erros.append(f"{med['no_tampo']} pontos atravessando o tampo")
    if med["no_encosto"] > 0:
        erros.append(f"{med['no_encosto']} pontos no encosto")
    return erros
