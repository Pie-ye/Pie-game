"""Skeleton + skin weights for a Hunyuan3D character GLB, run inside Blender (bpy) on a Colab VM.

  /content/bpy-venv/bin/python colab-rig.py <in.glb> <bones.json> <out.glb>

bones.json (written by rig_profiles.py): {"bones": [{"name","head":[x,y,z],"tail":[x,y,z],"parent","radius"}], "power": 4}
Coordinates are glTF space (Y up, character faces +Z), the same space as the GLB. Skin weights are inverse-distance to the
bone segments (minus a per-bone radius), smoothed over the welded mesh graph, then limited to 4 influences.
"""
import json, sys
import numpy as np
import bpy

src, bones_path, dst = sys.argv[1:4]
spec = json.load(open(bones_path))
bones = spec['bones']
POWER = spec.get('power', 4)
SMOOTH = spec.get('smooth', 6)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert meshes, 'no mesh in GLB'
if len(meshes) > 1:
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes: m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active
mesh.name = 'Body'
# bake any import transform so mesh space == world space
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Hunyuan exports unwelded triangles (3 vertices per face). Weld by position and smooth-shade so the exporter
# only splits vertices at real UV seams: ~3x smaller skinned GLB and smoother skinning.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()
print('welded verts', len(mesh.data.vertices))

def to_blender(p):  # glTF (x, y, z) -> Blender (x, -z, y)
    return (p[0], -p[2], p[1])

# ---- armature ----
arm_data = bpy.data.armatures.new('Rig')
arm = bpy.data.objects.new('Rig', arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for b in bones:
    e = arm_data.edit_bones.new(b['name'])
    e.head = to_blender(b['head']); e.tail = to_blender(b['tail'])
    if (e.tail - e.head).length < 1e-4: e.tail = e.head + type(e.head)((0, 0, 0.02))
    eb[b['name']] = e
for b in bones:
    if b.get('parent'): eb[b['name']].parent = eb[b['parent']]
bpy.ops.object.mode_set(mode='OBJECT')

# ---- weights (numpy) ----
vs = np.array([(v.co.x, v.co.z, -v.co.y) for v in mesh.data.vertices], dtype=np.float64)  # back to glTF space
n = len(vs)
heads = np.array([b['head'] for b in bones], dtype=np.float64)
tails = np.array([b['tail'] for b in bones], dtype=np.float64)
radii = np.array([b.get('radius', 0.05) for b in bones], dtype=np.float64)
seg = tails - heads
seg_len2 = np.maximum((seg * seg).sum(1), 1e-9)
dist = np.zeros((n, len(bones)))
for i in range(len(bones)):
    t = np.clip(((vs - heads[i]) @ seg[i]) / seg_len2[i], 0, 1)
    closest = heads[i] + t[:, None] * seg[i]
    dist[:, i] = np.linalg.norm(vs - closest, axis=1)
eff = np.maximum(dist - radii[None, :], 0.0) + 0.012
# optional per-bone y gates (e.g. head bones only above the chin)
for i, b in enumerate(bones):
    g = b.get('ymin')
    if g is not None: eff[vs[:, 1] < g, i] *= 8.0
    g = b.get('ymax')
    if g is not None: eff[vs[:, 1] > g, i] *= 8.0
# Hair that hangs next to the arms (braids) must not follow the arms: classify by baked texture hue and
# keep it off the arm bones.
if spec.get('hairHue'):
    lo, hi = spec['hairHue']; smin = spec.get('hairMinSat', 0.1)
    img = None
    for mat in mesh.data.materials:
        if mat and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image: img = node.image; break
        if img: break
    if img is not None:
        iw, ih = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(ih, iw, 4)
        nl = len(mesh.data.loops)
        vidx = np.zeros(nl, dtype=np.int32); mesh.data.loops.foreach_get('vertex_index', vidx)
        uvs = np.zeros(nl * 2, dtype=np.float32); mesh.data.uv_layers.active.data.foreach_get('uv', uvs); uvs = uvs.reshape(-1, 2)
        uv = np.zeros((n, 2)); uv[vidx] = uvs
        xi = np.clip((uv[:, 0] % 1.0) * iw, 0, iw - 1).astype(int); yi = np.clip((uv[:, 1] % 1.0) * ih, 0, ih - 1).astype(int)
        rgb = px[yi, xi, :3]
        mx, mn = rgb.max(1), rgb.min(1); dl = mx - mn
        sat = np.where(mx > 0, dl / np.maximum(mx, 1e-6), 0)
        hue = np.zeros(n)
        r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
        m1 = (dl > 1e-6) & (mx == r); m2 = (dl > 1e-6) & (mx == g); m3 = (dl > 1e-6) & (mx == b)
        hue[m1] = (60 * ((g - b)[m1] / dl[m1])) % 360; hue[m2] = 60 * ((b - r)[m2] / dl[m2]) + 120; hue[m3] = 60 * ((r - g)[m3] / dl[m3]) + 240
        hair = (hue >= lo) & (hue <= hi) & (sat >= smin) & (mx > 0.12)
        print('hair vertices', int(hair.sum()), 'of', n)
        for i, b_ in enumerate(bones):
            if b_['name'].split('_')[0] in ('Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'Fingers'):
                eff[hair, i] *= 40.0
        br = spec.get('braid')
        if br:
            # braid vertices (hair, out to the side, below the head) follow only the braid chain; everything else ignores it
            inb = hair & (np.abs(vs[:, 0]) > br['minX']) & (vs[:, 1] < br['maxY'])
            print('braid vertices', int(inb.sum()))
            for i, b_ in enumerate(bones):
                if b_['name'].startswith(br['prefix']):
                    eff[~inb, i] *= 60.0
                else:
                    eff[inb, i] *= 60.0
w = 1.0 / eff ** POWER
w /= w.sum(1, keepdims=True)
# weld duplicate positions (UV seams) and smooth over mesh edges
key = np.round(vs * 1e4).astype(np.int64)
_, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
inverse = inverse.reshape(-1)
m = len(first)
wel = np.zeros((m, len(bones)))
np.add.at(wel, inverse, w); cnt = np.bincount(inverse, minlength=m)[:, None]; wel /= cnt
edges = set()
for p in mesh.data.polygons:
    idx = [inverse[i] for i in p.vertices]
    for a in range(len(idx)):
        u, v = idx[a], idx[(a + 1) % len(idx)]
        if u != v: edges.add((min(u, v), max(u, v)))
ea = np.array(sorted(edges))
deg = np.bincount(np.concatenate([ea[:, 0], ea[:, 1]]), minlength=m)[:, None].astype(np.float64)
for _ in range(SMOOTH):
    acc = np.zeros_like(wel)
    np.add.at(acc, ea[:, 0], wel[ea[:, 1]]); np.add.at(acc, ea[:, 1], wel[ea[:, 0]])
    wel = 0.5 * wel + 0.5 * acc / np.maximum(deg, 1)
w = wel[inverse]
# keep top 4 influences
order = np.argsort(-w, axis=1)
keep = np.zeros_like(w, dtype=bool)
np.put_along_axis(keep, order[:, :4], True, axis=1)
w = np.where(keep, w, 0.0)
w /= w.sum(1, keepdims=True)

for b in bones: mesh.vertex_groups.new(name=b['name'])
groups = [mesh.vertex_groups[b['name']] for b in bones]
for j in range(len(bones)):
    col = w[:, j]
    idx = np.nonzero(col > 0.002)[0]
    for i in idx: groups[j].add([int(i)], float(col[i]), 'REPLACE')
mod = mesh.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
mesh.parent = arm
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_skins=True, export_animations=False,
                          export_yup=True, export_apply=False, export_image_format='AUTO')
print('RIG_DONE', dst, 'verts', n, 'bones', len(bones))
