"""Blender 內載入、整理 Poly Haven 道具模型（由 build_blend.py 匯入使用）。

load_prop(key)：匯入 glTF → 合併成單一網格 → 移到「底面中心＝原點」→ 減面 → 材質改名。
        回傳 Blender 物件（Z 向上；模型正面方向由 scene_gen.PROP_MODELS 的 yaw 校正）。
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

SRC = Path(__file__).resolve().parent / 'props_src'


def _tris(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def load_prop(key, spec, decimate=True):
    pid = spec['id']
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SRC / pid / f'{pid}.gltf'))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    # 一個檔案裡有新舊兩種外觀時，用名稱篩出要的那一種
    only, skip = spec.get('only'), spec.get('skip')
    empties = [o for o in new if o.type != 'MESH']
    skips = [skip] if isinstance(skip, str) else list(skip or [])
    keep = [o for o in meshes if (not only or only in o.name) and not any(k in o.name for k in skips)]
    for o in meshes:
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = keep
    # 把各部位的世界變換烘進網格，丟掉空物件的階層
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in empties:                  # 空物件（階層）不要了
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.objects.active = meshes[0]
    for o in meshes:
        o.select_set(True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = f'prop_{key}'
    if spec.get('rx'):                  # 模型本身是立著的但要平放（例如輪胎）
        ob.data.transform(__import__('mathutils').Matrix.Rotation(math.radians(spec['rx']), 4, 'X'))
    # 底面中心＝原點
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    ob.data.transform(__import__('mathutils').Matrix.Translation(-off))
    ob.location = (0, 0, 0)
    # 材質改名，避免與場景材質撞名
    for i, m in enumerate(ob.data.materials):
        m.name = f'prop_{key}_{i}'
        m.use_backface_culling = False
        # 不透明度貼圖不用（半透明排序麻煩、還多一張 PNG）
        bsdf = m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
        if bsdf is not None:
            for l in list(bsdf.inputs['Alpha'].links):
                m.node_tree.links.remove(l)
            bsdf.inputs['Alpha'].default_value = 1.0
        m.blend_method = 'OPAQUE'
    # 減面
    t0 = _tris(ob)
    if decimate and t0 > spec['tris']:
        mod = ob.modifiers.new('dec', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = max(0.005, spec['tris'] / t0)
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier='dec')
    # 平滑著色（法線貼圖會補細節）
    for p in ob.data.polygons:
        p.use_smooth = True
    ob['dims'] = [round(v, 3) for v in (mx - mn)]
    ob['tris_before'] = t0
    ob['tris_after'] = _tris(ob)
    return ob
