"""Hunyuan3D-2 image->textured GLB for every phoebe-egg asset (runs on the Colab T4).
Inputs:  /content/refs/<name>.png     Outputs: /content/textured/<name>.glb + textured.json
Run detached: nohup /content/phoebe-venv/bin/python -u colab-textured.py [names...] > /content/textured.log
"""
import gc, json, pathlib, sys, time, traceback
import torch
from PIL import Image
sys.path.insert(0, '/content/Hunyuan3D-2')
from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline, FaceReducer, FloaterRemover, DegenerateFaceRemover
from hy3dgen.texgen import Hunyuan3DPaintPipeline

NAMES = sys.argv[1:] or ['phoebe', 'reggie', 'plateau', 'ramp', 'rock', 'sakura_tree', 'torii', 'lantern',
                         'nest', 'tent', 'crate', 'flag', 'ladder', 'egg', 'cloud']
FACES = {'phoebe': 40000, 'phoebe_b': 40000, 'phoebe_c': 40000, 'reggie': 40000, 'reggie_roar': 30000, 'reggie_slam': 30000, 'reggie_charge': 30000, 'reggie_sweep': 30000, 'plateau': 12000, 'ramp': 8000, 'rock': 8000, 'sakura_tree': 16000, 'torii': 10000,
         'lantern': 6000, 'nest': 8000, 'tent': 8000, 'crate': 4000, 'flag': 5000, 'ladder': 4000, 'egg': 4000, 'cloud': 4000}
ITEM_NAMES = {'snack','coconut','berry_red','berry_blue','mushroom_item','energy_drink','medkit','bandage','antidote','hot_tea','ice_pack','rope_spool','piton','chain_launcher','blowdart','lantern_item'}
def faces_for(name):
    if name in FACES: return FACES[name]
    if name.startswith(('phoebe', 'reggie')): return 40000
    if name.endswith('_wall'): return 1800   # tiled hundreds of times: texture carries the detail
    if name.endswith('_ledge'): return 6000
    if name in ITEM_NAMES: return 2500
    return 8000
refs, out = pathlib.Path('/content/refs'), pathlib.Path('/content/textured'); out.mkdir(exist_ok=True)
todo = [n for n in NAMES if not (out / f'{n}-shape.glb').exists() and not (out / f'{n}.glb').exists()]
rembg = BackgroundRemover() if todo else None
shape = None if not todo else Hunyuan3DDiTFlowMatchingPipeline.from_pretrained('tencent/Hunyuan3D-2mini', subfolder='hunyuan3d-dit-v2-mini',
                                                          use_safetensors=True, device='cuda')
records = json.loads((out / 'textured.json').read_text()) if (out / 'textured.json').exists() else {}
meshes = {}
t0 = time.monotonic()
for name in NAMES:                      # stage 1: shapes (shape model resident, small)
    if (out / f'{name}.glb').exists() or (out / f'{name}-shape.glb').exists(): continue
    try:
        image = Image.open(refs / f'{name}.png').convert('RGBA')
        image = rembg(image.convert('RGB')) if image.getextrema()[3][0] == 255 else image
        started = time.monotonic()
        hero = name.startswith(('phoebe', 'reggie', 'ph_'))
        mesh = shape(image=image, num_inference_steps=40 if hero else 30, octree_resolution=320 if hero else 256, num_chunks=20000,
                     generator=torch.manual_seed(2026), output_type='trimesh')[0]
        mesh = FloaterRemover()(mesh); mesh = DegenerateFaceRemover()(mesh)
        raw = len(mesh.faces); mesh = FaceReducer()(mesh, max_facenum=faces_for(name))
        mesh.export(out / f'{name}-shape.glb'); image.save(out / f'{name}-cut.png')
        records[name] = dict(shape_seconds=time.monotonic() - started, raw_faces=raw, faces=len(mesh.faces))
        print('SHAPE', name, records[name], flush=True)
    except Exception: print('SHAPE_FAILED', name, traceback.format_exc(), flush=True)
shape = rembg = None; gc.collect(); torch.cuda.empty_cache()
import os
PAINT_SUB = os.environ.get('PAINT_SUB', 'hunyuan3d-paint-v2-0-turbo')
paint = Hunyuan3DPaintPipeline.from_pretrained('tencent/Hunyuan3D-2', subfolder=PAINT_SUB)
print('PAINT_PIPELINE_LOADED', flush=True)
try: paint.enable_model_cpu_offload()
except Exception as e: print('no cpu offload', e, flush=True)
import trimesh
for name in NAMES:                      # stage 2: textures
    if (out / f'{name}.glb').exists() or not (out / f'{name}-shape.glb').exists(): continue
    try:
        started = time.monotonic()
        mesh = trimesh.load(out / f'{name}-shape.glb', force='mesh')
        textured = paint(mesh, image=Image.open(out / f'{name}-cut.png'))
        textured.export(out / f'{name}.glb')
        records.setdefault(name, {})['paint_seconds'] = time.monotonic() - started
        print('PAINTED', name, records[name], flush=True)
    except Exception: print('PAINT_FAILED', name, traceback.format_exc(), flush=True)
    torch.cuda.empty_cache(); gc.collect()
    (out / 'textured.json').write_text(json.dumps(dict(model='tencent/Hunyuan3D-2mini shape + Hunyuan3D-2 paint-v2-0-turbo',
        seed=2026, gpu=torch.cuda.get_device_name(), assets=records), indent=2))
print('TEXTURED_COMPLETE', time.monotonic() - t0, flush=True)
