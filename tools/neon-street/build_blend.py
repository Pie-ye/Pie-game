"""在 Blender 內組裝星光電玩街並匯出 GLB。

用法（無頭）：
  blender -b -P build_blend.py -- --glb <輸出.glb> --json <輸出 scene.json> [--blend <輸出.blend>] [--render <預覽.png>]

先決條件：已跑過 make_textures.py（tex/ 內有貼圖）。
座標：scene_gen 用遊戲座標（Y 上、Z 南），Blender 為 Z 上，所以 (x, y, z)_game → (x, -z, y)_blender；
glTF 匯出器再轉回 Y 上，結果與遊戲座標一致。
"""
import json
import math
import sys
from pathlib import Path

import bpy

HERE = Path(bpy.data.filepath).parent if bpy.data.filepath else Path(__file__).resolve().parent
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scene_gen as S  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


GLB = arg('--glb')
JSON_OUT = arg('--json')
BLEND = arg('--blend')
RENDER = arg('--render')
TEX = HERE / 'tex'


def hex_rgba(h, a=1.0):
    h = h.lstrip('#')
    lin = lambda c: (c / 255) ** 2.2
    return (lin(int(h[0:2], 16)), lin(int(h[2:4], 16)), lin(int(h[4:6], 16)), a)


def bl(p):
    return (p[0], -p[2], p[1])


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


_img_cache = {}


def load_img(name, srgb=True):
    if name not in _img_cache:
        im = bpy.data.images.load(str(TEX / name))
        im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        _img_cache[name] = im
    return _img_cache[name]


def make_material(name, spec):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = spec['rough']
    bsdf.inputs['Metallic'].default_value = spec['metal']
    if spec['tex']:
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = load_img(spec['tex'])
        n.interpolation = 'Linear'
        nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = hex_rgba(spec['base'])
    if spec['emtex']:
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = load_img(spec['emtex'])
        nt.links.new(n.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = spec['es']
    elif spec['em']:
        bsdf.inputs['Emission Color'].default_value = hex_rgba(spec['em'])
        bsdf.inputs['Emission Strength'].default_value = spec['es']
    else:
        bsdf.inputs['Emission Strength'].default_value = 0.0
    m.use_backface_culling = not spec['double']
    return m


def build_mesh(name, faces, pivot):
    verts, polys, uvs = [], [], []
    for pts, uv in faces:
        base = len(verts)
        for p in pts:
            verts.append(bl(p))
        polys.append(tuple(range(base, base + len(pts))))
        uvs.extend(uv)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], polys)
    layer = me.uv_layers.new(name='UVMap')
    flat = []
    for u, v in uvs:
        flat.extend((u, v))
    layer.data.foreach_set('uv', flat)
    me.update()
    for poly in me.polygons:
        poly.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    ob.location = bl(pivot)
    return ob


def main():
    reset_scene()
    sc = S.build()
    print('scene stats', sc.stats)
    scene = bpy.context.scene
    coll = bpy.data.collections.new('StarArcadeStreet')
    scene.collection.children.link(coll)
    mats = {}
    used = {m for o in sc.geo.objs.values() for m in o['mats']}
    for name in sorted(used):
        mats[name] = make_material(name, S.MATERIALS[name])
    n_obj = 0
    for oname, o in sc.geo.objs.items():
        for mname, faces in o['mats'].items():
            ob = build_mesh(f'{oname}__{mname}' if oname != 'static' else f'mesh__{mname}', faces, o['pivot'])
            ob.data.materials.append(mats[mname])
            coll.objects.link(ob)
            n_obj += 1
    # 動畫部件：同一個名稱的多個材質物件要能被前端一起找到——名稱以 oname__ 開頭
    # 燈光標記（空物件），方便在 Blender 裡檢視與調整
    lcoll = bpy.data.collections.new('LightMarkers')
    scene.collection.children.link(lcoll)
    for i, l in enumerate(sc.lights):
        e = bpy.data.objects.new(f'light_{i}', None)
        e.empty_display_type = 'SPHERE'
        e.empty_display_size = 0.3
        e.location = bl(l['p'])
        e['color'] = l['c']
        e['intensity'] = l['i']
        e['distance'] = l['d']
        lcoll.objects.link(e)
    lcoll.hide_viewport = True
    lcoll.hide_render = True
    print('objects', n_obj, 'materials', len(mats))

    if JSON_OUT:
        data = dict(
            colliders=[c for c in sc.colliders if c['tag'] != 'far'],
            lights=sc.lights, parts=sc.parts, zones=sc.zones,
            spawn=dict(x=0.0, z=16.0, yaw=0.0),
            bounds=S.L - 1.6, avenueHalf=S.W, plazaR=S.R, ring=S.RING, eye=S.EYE,
            stats=sc.stats,
        )
        Path(JSON_OUT).parent.mkdir(parents=True, exist_ok=True)
        Path(JSON_OUT).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
        print('wrote', JSON_OUT)

    if BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=BLEND, relative_remap=True)
        print('wrote', BLEND)

    if GLB:
        Path(GLB).parent.mkdir(parents=True, exist_ok=True)
        # 只匯出場景模型（燈光標記是空物件，不匯出）
        bpy.ops.object.select_all(action='DESELECT')
        for ob in coll.objects:
            ob.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=GLB, export_format='GLB', use_selection=True, export_apply=True,
            export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
            export_image_format='AUTO', export_cameras=False, export_lights=False,
            export_extras=False, export_animations=False, export_draco_mesh_compression_enable=False,
        )
        print('wrote', GLB, Path(GLB).stat().st_size // 1024, 'KB')

    if RENDER:
        render_preview(RENDER)


def render_preview(path):
    """用 Cycles（CPU、低取樣）渲一張鳥瞰預覽，確認 Blender 內的場景是完整的。"""
    scene = bpy.context.scene
    world = bpy.data.worlds.new('night')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.02, 0.01, 0.05, 1)
    bg.inputs['Strength'].default_value = 1.0
    scene.world = world
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.location = bl((80, 190, 170))          # 遊戲座標：東南方高空
    cam.data.lens = 24
    cam.data.clip_end = 2000
    target = bpy.data.objects.new('target', None)
    target.location = bl((0, 6, 0))
    scene.collection.objects.link(target)
    con = cam.constraints.new('TRACK_TO')
    con.target = target
    con.track_axis = 'TRACK_NEGATIVE_Z'
    con.up_axis = 'UP_Y'
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('rendered', path)


main()
