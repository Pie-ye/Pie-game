import bpy, sys, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scene_gen as S, props_blender as PB
out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
x = 0.0
keys = list(S.PROP_MODELS)
for k in keys:
    ob = PB.load_prop(k, S.PROP_MODELS[k])
    d = list(ob['dims'])
    ob.location = (x + d[0] / 2, 0, 0)
    print('PROP', k, 'dims', d, 'tris', ob['tris_before'], '->', ob['tris_after'], 'mats', len(ob.data.materials))
    x += d[0] + 0.8
scene = bpy.context.scene
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = x * 1.02
cam.location = (x / 2, -20, 1.3); cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 2000; scene.render.resolution_y = int(2000 * 2.8 / (x * 1.02)) + 40
cam.location.z = 1.4
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
