"""Peças comuns dos scripts do Blender (bpy 5.2.2) que montam as pessoas do salão 3D.

Um pipeline só (Blender) para malha, esqueleto e poses. Como o Rocketbox funciona:

- O FBX do avatar e o FBX de cada clipe trazem o mesmo esqueleto "Bip01" do 3ds Max,
  mas o FBX do clipe não tem pose de ligação: o Blender usa um quadro qualquer como
  repouso. Por isso NÃO dá para só trocar a ação do avatar pela do clipe (é o que
  girava a pelve 90° na pesquisa). Aqui o clipe é copiado em espaço de mundo: cada osso
  do avatar copia a rotação de mundo do osso de mesmo nome do clipe e a pelve copia
  também a posição. Os eixos locais dos ossos são os mesmos do Max nos dois arquivos.
- O nó "Bip01" vira o objeto da armadura e leva o movimento da raiz como animação de
  objeto. O clipe fica pendurado num vazio ("ajuste") que gira e desloca a pessoa
  sem mexer nas curvas do clipe.

Referencial de saída (o do glTF / three.js): metro, y para cima, pessoa olhando +z.
No Blender (z para cima) isso é olhar para -y. As medidas saem já no referencial glTF:
(x, y, z)_gltf = (x, z, -y)_blender.
"""

from __future__ import annotations

import math
import os
import re

import bpy
from mathutils import Matrix, Vector

QUADROS_POR_SEGUNDO = 30


def limpar() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = QUADROS_POR_SEGUNDO


def gltf(v: Vector) -> tuple[float, float, float]:
    """Ponto do Blender (z para cima) no referencial glTF (y para cima, frente +z)."""
    return (v.x, v.z, -v.y)


# ---------------------------------------------------------------- avatar e materiais


def importar_avatar(pasta: str, nome: str, tex_px: int = 1024):
    """Importa <pasta>/<nome>.fbx, troca os materiais por 3 simples e devolve (armadura, malhas)."""
    antes = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=os.path.join(pasta, f"{nome}.fbx"),
        use_anim=False,
        automatic_bone_orientation=False,
    )
    novos = [o for o in bpy.data.objects if o not in antes]
    arm = next(o for o in novos if o.type == "ARMATURE")
    arm.name = "avatar"
    malhas = [o for o in novos if o.type == "MESH"]
    for o in [o for o in novos if o.type == "EMPTY"]:
        # "Bip01 Footsteps" do Biped: não serve para nada aqui
        bpy.data.objects.remove(o, do_unlink=True)
    for m in malhas:
        for a in list(m.data.color_attributes):  # cores de vértice do Max
            m.data.color_attributes.remove(a)
    materiais = criar_materiais(pasta, tex_px)
    for m in malhas:
        for slot in m.material_slots:
            n = (slot.material.name if slot.material else "").lower()
            parte = "cabelo" if "opacity" in n else "cabeca" if "head" in n else "corpo"
            slot.material = materiais[parte]
    return arm, malhas


def _textura(pasta: str, parte: str) -> str | None:
    for f in sorted(os.listdir(pasta)):
        if re.search(rf"_{parte}_color(_[a-z])?\.tga$", f.lower()):
            return os.path.join(pasta, f)
    return None


def criar_materiais(pasta: str, tex_px: int) -> dict[str, bpy.types.Material]:
    """corpo, cabeca e cabelo: cor de base com textura; o cabelo usa o alfa da textura."""
    materiais = {}
    for parte, arquivo in (("corpo", "body"), ("cabeca", "head"), ("cabelo", "opacity")):
        mat = bpy.data.materials.new(parte)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        saida = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 0.75
        bsdf.inputs["Metallic"].default_value = 0.0
        nt.links.new(bsdf.outputs["BSDF"], saida.inputs["Surface"])
        caminho = _textura(pasta, arquivo)
        if caminho:
            img = bpy.data.images.load(caminho, check_existing=True)
            img.name = f"{parte}_cor"
            w, h = img.size
            if max(w, h) > tex_px:
                img.scale(tex_px, tex_px)
            alfa = parte == "cabelo"
            img.file_format = "PNG" if alfa else "JPEG"
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if alfa:
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        materiais[parte] = mat
    return materiais


def aplicar_transformacoes(arm) -> None:
    """Deixa a armadura com transformação identidade (escala 1, sem giro), malhas junto."""
    bpy.ops.object.select_all(action="DESELECT")
    filhos = [o for o in bpy.data.objects if o.parent == arm]
    for o in [arm, *filhos]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


# ---------------------------------------------------------------- clipes


def importar_clipe(caminho: str):
    """Importa o FBX de um clipe. Devolve (armadura do clipe, vazio de ajuste, (ini, fim))."""
    antes = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=caminho, use_anim=True, automatic_bone_orientation=False)
    novos = [o for o in bpy.data.objects if o not in antes]
    clip = next(o for o in novos if o.type == "ARMATURE")
    clip.name = "clipe"
    for o in novos:
        if o.type == "EMPTY" and o.parent is None:
            bpy.data.objects.remove(o, do_unlink=True)
    ajuste = bpy.data.objects.new("ajuste", None)
    bpy.context.scene.collection.objects.link(ajuste)
    clip.parent = ajuste
    ini, fim = clip.animation_data.action.frame_range
    return clip, ajuste, (int(ini), int(fim))


def remover_clipe(clip, ajuste) -> None:
    acao = clip.animation_data.action if clip.animation_data else None
    bpy.data.objects.remove(clip, do_unlink=True)
    bpy.data.objects.remove(ajuste, do_unlink=True)
    if acao is not None:
        bpy.data.actions.remove(acao)


def ligar(arm, clip) -> None:
    """Cada osso do avatar copia a rotação de mundo do osso do clipe; a pelve, a posição."""
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        if pb.name not in clip.pose.bones:
            continue
        rot = pb.constraints.new("COPY_ROTATION")
        rot.target, rot.subtarget = clip, pb.name
        rot.target_space = rot.owner_space = "WORLD"
        if pb.parent is None:
            loc = pb.constraints.new("COPY_LOCATION")
            loc.target, loc.subtarget = clip, pb.name
            loc.target_space = loc.owner_space = "WORLD"


def ir_para(quadro: float) -> None:
    cena = bpy.context.scene
    inteiro = math.floor(quadro)
    cena.frame_set(inteiro, subframe=quadro - inteiro)
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- medidas


def osso_mundo(arm, nome: str) -> Vector:
    return arm.matrix_world @ arm.pose.bones[nome].head


def frente(arm) -> Vector:
    """Direção para onde a pessoa olha (horizontal, no Blender): média pé->dedos e pelve->joelho."""
    v = Vector((0.0, 0.0, 0.0))
    for lado in "LR":
        pe = osso_mundo(arm, f"Bip01 {lado} Foot")
        dedo = osso_mundo(arm, f"Bip01 {lado} Toe0")
        v += dedo - pe
    v.z = 0
    return v.normalized()


def grupo_dominante(malha) -> list[str]:
    nomes = {g.index: g.name for g in malha.vertex_groups}
    dominante = []
    for v in malha.data.vertices:
        melhor, peso = "", -1.0
        for g in v.groups:
            if g.weight > peso:
                melhor, peso = nomes.get(g.group, ""), g.weight
        dominante.append(melhor)
    return dominante


def malha_avaliada(malhas) -> tuple[list[Vector], list[str]]:
    """Vértices deformados em mundo (Blender) e o osso dominante de cada um."""
    dg = bpy.context.evaluated_depsgraph_get()
    pontos, ossos = [], []
    for m in malhas:
        ev = m.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        dom = grupo_dominante(m)
        for i, v in enumerate(me.vertices):
            pontos.append(mw @ v.co)
            ossos.append(dom[i] if i < len(dom) else "")
        ev.to_mesh_clear()
    return pontos, ossos


def assar(malhas, nome: str):
    """Cria um objeto estático (sem esqueleto) com a pose atual, em coordenadas de mundo."""
    dg = bpy.context.evaluated_depsgraph_get()
    partes = []
    for m in malhas:
        ev = m.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=dg)
        me.transform(ev.matrix_world)
        ob = bpy.data.objects.new(f"{nome}_{m.name}", me)
        bpy.context.scene.collection.objects.link(ob)
        ob.vertex_groups.clear()
        partes.append(ob)
    bpy.ops.object.select_all(action="DESELECT")
    for p in partes:
        p.select_set(True)
    bpy.context.view_layer.objects.active = partes[0]
    if len(partes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = nome
    ob.data.name = nome
    return ob


def transformar(ob, matriz: Matrix) -> None:
    ob.data.transform(matriz)
    ob.data.update()


def exportar_glb(caminho: str, objetos, animacoes: bool = False) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objetos:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=caminho,
        export_format="GLB",
        use_selection=True,
        export_image_format="AUTO",
        export_jpeg_quality=90,
        export_yup=True,
        export_apply=False,
        export_skins=animacoes,
        export_animations=animacoes,
        export_morph=False,
        export_def_bones=False,
        export_optimize_animation_size=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_anim_slide_to_zero=True,  # cada clipe começa em t = 0 (laço sem quadro parado)
        export_vertex_color="NONE",
        export_extras=True,
    )
