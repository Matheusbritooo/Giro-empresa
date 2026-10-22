"""Garçom com esqueleto e três clipes (parado, andando, anotando), num GLB só.

Uso (bpy 5.2.2, Python 3.13):
  python -I blender/garcom.py -- <config.json> <pasta_downloads> <saida.glb> <medidas.json>

O que faz:
  1. Importa o avatar (FBX do Rocketbox), escala para a altura do config e deixa a
     armadura com transformação identidade (sem os 90° do Max).
  2. Para cada clipe: liga o avatar ao clipe em espaço de mundo (comum.ligar), gira o
     clipe para a pessoa olhar +z do glTF e corrige a altura da pelve pela razão entre as
     pernas do avatar e as do clipe, para o pé não afundar nem flutuar.
  3. Escolhe a janela do clipe que fecha o laço com a menor diferença de pose e funde os
     últimos quadros no primeiro (sem tranco no laço). A caminhada fica no lugar: tira
     o deslocamento horizontal da pelve que sobrou no clipe.
  4. Assa cada clipe numa ação (rotação de todos os ossos, posição só da pelve) e exporta.
  5. Mede: pés em y = 0, frente +z, velocidade natural da caminhada pelo pé de apoio.
"""

from __future__ import annotations

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import avental  # noqa: E402
import bpy  # noqa: E402
import comum  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
config_path, downloads, saida, medidas_path = args[:4]
with open(config_path) as f:
    config = json.load(f)["garcom"]

comum.limpar()
nome = config["avatar"]
arm, malhas = comum.importar_avatar(os.path.join(downloads, "rocketbox", nome), nome)
pts, _ = comum.malha_avaliada(malhas)
altura_original = max(p.z for p in pts) - min(p.z for p in pts)
escala = config["altura"] / altura_original
arm.scale = (arm.scale[0] * escala, arm.scale[1] * escala, arm.scale[2] * escala)
bpy.context.view_layer.update()
comum.aplicar_transformacoes(arm)
if config.get("avental"):
    malhas.append(avental.criar(arm, malhas))

ORDEM: list[str] = []


def _visitar(osso) -> None:
    ORDEM.append(osso.name)
    for filho in osso.children:
        _visitar(filho)


for raiz in [b for b in arm.data.bones if b.parent is None]:
    _visitar(raiz)
RAIZ = ORDEM[0]  # "Bip01 Pelvis"


def comprimento_perna(armadura, repouso: bool) -> float:
    """Quadril -> joelho -> tornozelo, em metros de mundo."""
    total = 0.0
    for lado in "LR":
        nomes = [f"Bip01 {lado} Thigh", f"Bip01 {lado} Calf", f"Bip01 {lado} Foot"]
        if repouso:
            pontos = [armadura.matrix_world @ armadura.data.bones[n].head_local for n in nomes]
        else:
            pontos = [armadura.matrix_world @ armadura.pose.bones[n].head for n in nomes]
        total += (pontos[1] - pontos[0]).length + (pontos[2] - pontos[1]).length
    return total / 2


def sola(malhas_) -> float:
    pontos, _ = comum.malha_avaliada(malhas_)
    return min(p.z for p in pontos)


def poses_visuais(quadros) -> list[dict[str, Matrix]]:
    """Matriz de pose (espaço da armadura) de cada osso em cada quadro, com as restrições."""
    saida_ = []
    for q in quadros:
        comum.ir_para(q)
        saida_.append({n: arm.pose.bones[n].matrix.copy() for n in ORDEM})
    return saida_


def para_base(visuais: dict[str, Matrix]) -> dict[str, Matrix]:
    """Converte a pose vista de cada osso na transformação local (matrix_basis) dele."""
    base = {}
    for n in ORDEM:
        b = arm.data.bones[n]
        if b.parent is None:
            base[n] = b.matrix_local.inverted() @ visuais[n]
        else:
            rel = b.parent.matrix_local.inverted() @ b.matrix_local
            base[n] = rel.inverted() @ visuais[b.parent.name].inverted() @ visuais[n]
    return base


def diferenca(a: dict[str, Matrix], b: dict[str, Matrix]) -> float:
    """Diferença entre duas poses: soma dos ângulos (rad) mais a distância da pelve (m) x 10."""
    total = 0.0
    for n in ORDEM:
        qa, qb = a[n].to_quaternion(), b[n].to_quaternion()
        total += qa.rotation_difference(qb).angle
    total += 10 * (a[RAIZ].to_translation() - b[RAIZ].to_translation()).length
    return total


def misturar(a: Matrix, b: Matrix, t: float) -> Matrix:
    la, ra, _ = a.decompose()
    lb, rb, _ = b.decompose()
    return Matrix.LocRotScale(la.lerp(lb, t), ra.slerp(rb, t), None)


medidas: dict = {
    "avatar": nome,
    "escala": round(escala, 4),
    "altura": config["altura"],
    "clipes": {},
}
acoes = []
for nome_clipe, c in config["clipes"].items():
    clip, ajuste, (ini, fim) = comum.importar_clipe(
        os.path.join(downloads, "animacoes", f"{c['arquivo']}.fbx")
    )
    comum.ligar(arm, clip)
    comum.ir_para(ini)
    # 1) frente: girar o clipe em volta da pelve para olhar -y do Blender (+z do glTF)
    f = comum.frente(arm)
    pelve = comum.osso_mundo(arm, RAIZ).copy()
    if c.get("no_lugar"):
        # na caminhada a frente é para onde a pelve anda no clipe
        comum.ir_para(fim)
        f = comum.osso_mundo(arm, RAIZ) - pelve
        f.z = 0
        comum.ir_para(ini)
    ang = math.atan2(f.x, -f.y)
    razao = comprimento_perna(arm, repouso=True) / comprimento_perna(clip, repouso=False)
    # leva a pelve para cima da origem, escala em volta do chão e gira em volta do eixo vertical
    ajuste.matrix_world = (
        Matrix.Rotation(-ang, 4, "Z")
        @ Matrix.Scale(razao, 4)
        @ Matrix.Translation(Vector((-pelve.x, -pelve.y, 0.0)))
    )
    bpy.context.view_layer.update()
    # 2) janela do laço
    a, b = c.get("inicio", ini), c.get("fim", fim)
    if c.get("procurar_laco"):
        # [menor, maior] duração em quadros: a janela cujo fim mais se parece com o começo
        menor_d, maior_d = c["procurar_laco"]
        cache = {}

        def pose(q: int, cache=cache) -> dict[str, Matrix]:
            if q not in cache:
                cache[q] = poses_visuais([q])[0]
            return cache[q]

        melhor = None
        for q0 in range(a, b - menor_d + 1, 3):
            for q1 in range(q0 + menor_d, min(b, q0 + maior_d) + 1, 3):
                d = diferenca(pose(q0), pose(q1))
                if melhor is None or d < melhor[0]:
                    melhor = (d, q0, q1)
        a, b = melhor[1], melhor[2]
    quadros = list(range(a, b + 1))
    visuais = poses_visuais(quadros)
    # 3) altura: a sola mais baixa do clipe no chão
    menor = math.inf
    for q in quadros[:: max(1, len(quadros) // 24)]:
        comum.ir_para(q)
        menor = min(menor, sola(malhas))
    ajuste.matrix_world = Matrix.Translation(Vector((0.0, 0.0, -menor))) @ ajuste.matrix_world
    bpy.context.view_layer.update()
    visuais = poses_visuais(quadros)
    # 4) caminhada no lugar: tira a deriva horizontal da pelve (tendência linear)
    if c.get("no_lugar"):
        p_ini = visuais[0][RAIZ].to_translation()
        p_fim = visuais[-1][RAIZ].to_translation()
        deriva = Vector((p_fim.x - p_ini.x, p_fim.y - p_ini.y, 0.0))
        media = Vector((0.0, 0.0, 0.0))
        for v in visuais:
            media += v[RAIZ].to_translation()
        media /= len(visuais)
        for i, v in enumerate(visuais):
            t = i / (len(visuais) - 1)
            corr = Vector((-media.x, -media.y, 0.0)) - deriva * (t - 0.5)
            v[RAIZ] = Matrix.Translation(corr) @ v[RAIZ]
        medidas["clipes"][nome_clipe] = {"deriva_tirada_m": round(deriva.length, 4)}
    else:
        medidas["clipes"][nome_clipe] = {}
    erro_laco = diferenca(visuais[0], visuais[-1])
    # 5) fecha o laço: funde os últimos quadros no primeiro
    fundir = min(c.get("fundir", 0), len(visuais) // 3)
    for k in range(fundir):
        i = len(visuais) - fundir + k
        t = (k + 1) / fundir
        visuais[i] = {n: misturar(visuais[i][n], visuais[0][n], t) for n in ORDEM}
    bases = [para_base(v) for v in visuais]
    # 6) assa numa ação nova
    for pb in arm.pose.bones:
        for restr in list(pb.constraints):
            pb.constraints.remove(restr)
    acao = bpy.data.actions.new(nome_clipe)
    acao.use_fake_user = True
    # faixa fixa 1..N: o exportador não põe um quadro a mais e o laço fecha certinho
    acao.use_frame_range = True
    acao.frame_start, acao.frame_end = 1, len(bases)
    arm.animation_data_create()
    arm.animation_data.action = acao
    anterior: dict[str, Quaternion] = {}
    for i, base in enumerate(bases):
        quadro = i + 1
        for n in ORDEM:
            pb = arm.pose.bones[n]
            pb.rotation_mode = "QUATERNION"
            loc, rot, _ = base[n].decompose()
            # quaternions vizinhos no mesmo hemisfério (sem volta de 360° na interpolação)
            if n in anterior and anterior[n].dot(rot) < 0:
                rot.negate()
            anterior[n] = rot.copy()
            pb.rotation_quaternion = rot
            pb.keyframe_insert("rotation_quaternion", frame=quadro, group=n)
            if n == RAIZ:
                pb.location = loc
                pb.keyframe_insert("location", frame=quadro, group=n)
    medidas["clipes"][nome_clipe].update(
        {
            "arquivo": c["arquivo"],
            "quadros_fonte": [a, b],
            "quadros": len(bases),
            "segundos": round((len(bases) - 1) / comum.QUADROS_POR_SEGUNDO, 3),
            "erro_laco_antes_de_fundir": round(erro_laco, 3),
            "quadros_fundidos": fundir,
            "razao_pernas": round(razao, 4),
        }
    )
    acoes.append(acao)
    arm.animation_data.action = None
    comum.remover_clipe(clip, ajuste)

# Cada ação numa faixa de NLA para o exportador levar todas.
ad = arm.animation_data
for acao in acoes:
    faixa = ad.nla_tracks.new()
    faixa.name = acao.name
    faixa.strips.new(acao.name, 1, acao)
ad.action = None


def tocar(acao, quadro: int) -> None:
    arm.animation_data.action = acao
    if hasattr(arm.animation_data, "action_slot") and acao.slots:
        arm.animation_data.action_slot = acao.slots[0]
    comum.ir_para(quadro)


for faixa in ad.nla_tracks:
    faixa.mute = True

# Medidas finais com as ações assadas (o que vai para o GLB).
for acao in acoes:
    n_quadros = int(acao.frame_range[1])
    soles, frentes = [], []
    pes = {"L": [], "R": []}
    for q in range(1, n_quadros + 1):
        tocar(acao, q)
        soles.append(sola(malhas))
        frentes.append(comum.frente(arm))
        for lado in "LR":
            pes[lado].append(comum.osso_mundo(arm, f"Bip01 {lado} Toe0").copy())
    fm = Vector((0.0, 0.0, 0.0))
    for v in frentes:
        fm += v
    fm.normalize()
    m = medidas["clipes"][acao.name]
    m["sola_min_m"] = round(min(soles), 4)
    m["sola_media_do_min_por_quadro_m"] = round(sum(soles) / len(soles), 4)
    # ângulo da frente média em relação a +z do glTF (= -y do Blender), em graus
    m["frente_glTF"] = [round(fm.x, 3), round(fm.z, 3), round(-fm.y, 3)]
    m["desvio_frente_graus"] = round(math.degrees(math.atan2(fm.x, -fm.y)), 2)
    if acao.name == "andando":
        # velocidade natural: o pé de apoio (o mais baixo) anda para trás na velocidade
        # com que a pessoa andaria para a frente.
        dt = 1 / comum.QUADROS_POR_SEGUNDO
        vel = []
        for i in range(1, n_quadros):
            lado = "L" if pes["L"][i].z < pes["R"][i].z else "R"
            if pes[lado][i].z > min(v.z for v in pes[lado]) + 0.03:
                continue
            d = pes[lado][i] - pes[lado][i - 1]
            vel.append(math.hypot(d.x, d.y) / dt)
        vel.sort()
        m["velocidade_m_s"] = round(vel[len(vel) // 2], 3)
        m["amostras_velocidade"] = len(vel)
        passada = m["velocidade_m_s"] * m["segundos"]
        m["passada_m"] = round(passada, 3)

pts, _ = comum.malha_avaliada(malhas)
ad.action = None
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
pts, _ = comum.malha_avaliada(malhas)
medidas["altura_repouso_m"] = round(max(p.z for p in pts) - min(p.z for p in pts), 4)
tris = 0
for mm in malhas:
    mm.data.calc_loop_triangles()
    tris += len(mm.data.loop_triangles)
medidas["triangulos_fonte"] = tris
medidas["ossos"] = len(arm.data.bones)

for faixa in ad.nla_tracks:
    faixa.mute = False
arm.name = "garcom"
for mm in malhas:
    nome_malha = "garcom_avental" if mm.name == "avental" else "garcom_corpo"
    mm.name = nome_malha
    mm.data.name = nome_malha
comum.exportar_glb(saida, [arm, *malhas], animacoes=True)
with open(medidas_path, "w") as f:
    json.dump(medidas, f, indent=2, ensure_ascii=False)
print("GARCOM", json.dumps(medidas, ensure_ascii=False))
