"""Avental de garçom (escuro, da cintura até abaixo do joelho), feito no Blender e com pele.

O avatar Business_Male_06 já tem camisa branca e calça escura; o avental é o que faz ele
ser lido como garçom de cantina e não como cliente de camisa social.

Como é feito (na pose de repouso, depois de escalar e aplicar as transformações):
  - Uma folha em arco na frente e nos lados do quadril (de -ARCO a +ARCO graus em volta da
    pelve, 0 = frente da pessoa), da cintura até um pouco abaixo do joelho.
  - Em cada altura e direção o raio é o contorno do corpo (calça) mais uma folga. Descendo,
    o raio nunca diminui: o pano cai reto a partir da parte mais larga (barriga, coxa).
  - Pesos da pele: no alto só a pelve; descendo, cada lado passa a seguir a coxa do seu
    lado (no meio, metade de cada), para o pano acompanhar a perna na caminhada.
"""

from __future__ import annotations

import math

import bpy
from comum import grupo_dominante
from mathutils import Vector

ARCO = 105.0  # graus para cada lado a partir da frente
FOLGA = 0.022  # metro entre o corpo e o pano
COR = (0.045, 0.040, 0.037, 1.0)  # quase preto, puxado para o marrom (linear)


def _contorno(pontos, centro: Vector, h: float, ang: float, faixa: float = 0.025) -> float:
    """Maior distância horizontal do corpo na direção `ang` (rad, 0 = frente) perto da altura h."""
    melhor = 0.0
    for p in pontos:
        if abs(p.z - h) > faixa:
            continue
        dx, dy = p.x - centro.x, p.y - centro.y
        a = math.atan2(dx, -dy)
        if abs((a - ang + math.pi) % (2 * math.pi) - math.pi) > math.radians(9):
            continue
        melhor = max(melhor, math.hypot(dx, dy))
    return melhor


def criar(arm, malhas, n_ang: int = 29, n_alt: int = 16):
    """Cria o avental como malha com pele no `arm`. Devolve o objeto."""
    pelve = arm.matrix_world @ arm.data.bones["Bip01 Pelvis"].head_local
    coxa_l = arm.matrix_world @ arm.data.bones["Bip01 L Thigh"].head_local
    joelho = arm.matrix_world @ arm.data.bones["Bip01 L Calf"].head_local
    # pontos do corpo sem os braços (na pose A as mãos ficam na altura do quadril)
    pontos = []
    for m in malhas:
        dom = grupo_dominante(m)
        for i, v in enumerate(m.data.vertices):
            osso = dom[i] if i < len(dom) else ""
            if any(k in osso for k in ("Arm", "Hand", "Finger", "Clavicle")):
                continue
            pontos.append(m.matrix_world @ v.co)
    topo = pelve.z + 0.075
    base = joelho.z - 0.10
    centro = Vector((pelve.x, pelve.y, 0.0))
    lado_l = 1.0 if coxa_l.x > pelve.x else -1.0

    verts, pesos = [], []
    raios_acima = [0.0] * n_ang
    for j in range(n_alt):
        t = j / (n_alt - 1)
        h = topo + (base - topo) * t
        for i in range(n_ang):
            ang = math.radians(-ARCO + 2 * ARCO * i / (n_ang - 1))
            r = _contorno(pontos, centro, h, ang)
            if j == 0 and r == 0.0:
                r = 0.16
            # o pano cai reto: nunca entra abaixo do ponto mais largo acima
            r = max(r + FOLGA + 0.03 * t, raios_acima[i])
            raios_acima[i] = r
            x = centro.x + r * math.sin(ang)
            y = centro.y - r * math.cos(ang)
            verts.append((x, y, h))
            # pesos: pelve no alto, coxas embaixo; lado pela posição em x
            coxa = min(1.0, 1.15 * t**0.75)
            lado = max(0.0, min(1.0, 0.5 + lado_l * (x - pelve.x) / 0.09))
            pesos.append(
                {
                    "Bip01 Pelvis": 1 - coxa,
                    "Bip01 L Thigh": coxa * lado,
                    "Bip01 R Thigh": coxa * (1 - lado),
                }
            )
    faces = []
    for j in range(n_alt - 1):
        for i in range(n_ang - 1):
            a = j * n_ang + i
            # sentido para a normal apontar para fora (frente)
            faces.append((a, a + 1, a + n_ang + 1, a + n_ang))
    me = bpy.data.meshes.new("avental")
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = ((vi % n_ang) / (n_ang - 1), 1 - (vi // n_ang) / (n_alt - 1))
    # normais para fora: confere com a frente (-y) no meio do avental
    meio = me.polygons[(n_alt // 2) * (n_ang - 1) + (n_ang - 1) // 2]
    if meio.normal.y > 0:
        for p in me.polygons:
            p.flip()
    me.shade_smooth()
    ob = bpy.data.objects.new("avental", me)
    bpy.context.scene.collection.objects.link(ob)
    for nome in ("Bip01 Pelvis", "Bip01 L Thigh", "Bip01 R Thigh"):
        g = ob.vertex_groups.new(name=nome)
        for vi, p in enumerate(pesos):
            if p[nome] > 1e-4:
                g.add([vi], p[nome], "REPLACE")
    ob.parent = arm
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mat = bpy.data.materials.new("avental")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = COR
    bsdf.inputs["Roughness"].default_value = 0.9
    mat.use_backface_culling = False
    me.materials.append(mat)
    return ob
