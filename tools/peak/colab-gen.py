"""Hunyuan3D-2 image -> textured GLB for the PEAK game (Colab L4, phoebe-venv from tools/phoebe-egg/colab-*.py).

Inputs : /content/peak/refs/<group>/<name>.png
Outputs: /content/peak/glb/<group>/<name>.glb (+ <name>-shape.glb, <name>-cut.png) and glb/<group>/gen.json
Run detached:
  nohup /content/phoebe-venv/bin/python -u colab-gen.py <group> [names...] > /content/peak/gen-<group>.log 2>&1 &
Idempotent: finished names are skipped, so rerun after uploading more refs.
Stage 1 builds every missing shape (shape model resident), stage 2 paints them (paint model resident).
"""
import gc, json, pathlib, sys, time, traceback
import torch
from PIL import Image
sys.path.insert(0, '/content/Hunyuan3D-2')
from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline, FaceReducer, FloaterRemover, DegenerateFaceRemover
from hy3dgen.texgen import Hunyuan3DPaintPipeline

group = sys.argv[1]
refs = pathlib.Path('/content/peak/refs') / group
out = pathlib.Path('/content/peak/glb') / group
out.mkdir(parents=True, exist_ok=True)
names = sys.argv[2:] or sorted(p.stem for p in refs.glob('*.png'))
# face budgets: characters need enough density to skin hands/knees; props stay light for the 50 MB game budget
FACES = {'chars': 50000, 'items': 5000, 'world': 12000}
CHAR_STEPS = {'chars': (50, 384)}
budget = FACES.get(group, 8000)
steps, octree = CHAR_STEPS.get(group, (40, 320))

todo = [n for n in names if not (out / f'{n}.glb').exists() and not (out / f'{n}-shape.glb').exists()]
records = json.loads((out / 'gen.json').read_text()) if (out / 'gen.json').exists() else {}
t0 = time.monotonic()
if todo:
    rembg = BackgroundRemover()
    shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained('tencent/Hunyuan3D-2mini', subfolder='hunyuan3d-dit-v2-mini',
                                                              use_safetensors=True, device='cuda')
    for name in todo:
        try:
            image = Image.open(refs / f'{name}.png').convert('RGBA')
            image = rembg(image.convert('RGB')) if image.getextrema()[3][0] == 255 else image
            started = time.monotonic()
            mesh = shape(image=image, num_inference_steps=steps, octree_resolution=octree, num_chunks=20000,
                         generator=torch.manual_seed(2026), output_type='trimesh')[0]
            mesh = FloaterRemover()(mesh); mesh = DegenerateFaceRemover()(mesh)
            raw = len(mesh.faces); mesh = FaceReducer()(mesh, max_facenum=budget)
            mesh.export(out / f'{name}-shape.glb'); image.save(out / f'{name}-cut.png')
            records[name] = dict(shape_seconds=round(time.monotonic() - started, 1), raw_faces=raw, faces=len(mesh.faces))
            print('SHAPE', name, records[name], flush=True)
        except Exception:
            print('SHAPE_FAILED', name, traceback.format_exc(), flush=True)
    shape = rembg = None; gc.collect(); torch.cuda.empty_cache()

pending = [n for n in names if not (out / f'{n}.glb').exists() and (out / f'{n}-shape.glb').exists()]
if pending:
    import trimesh
    paint = Hunyuan3DPaintPipeline.from_pretrained('tencent/Hunyuan3D-2', subfolder='hunyuan3d-paint-v2-0-turbo')
    print('PAINT_PIPELINE_LOADED', flush=True)
    for name in pending:
        try:
            started = time.monotonic()
            mesh = trimesh.load(out / f'{name}-shape.glb', force='mesh')
            textured = paint(mesh, image=Image.open(out / f'{name}-cut.png'))
            textured.export(out / f'{name}.glb')
            records.setdefault(name, {})['paint_seconds'] = round(time.monotonic() - started, 1)
            print('PAINTED', name, records[name], flush=True)
        except Exception:
            print('PAINT_FAILED', name, traceback.format_exc(), flush=True)
        torch.cuda.empty_cache(); gc.collect()
        (out / 'gen.json').write_text(json.dumps(dict(model='Hunyuan3D-2mini shape + Hunyuan3D-2 paint-v2-0-turbo', seed=2026,
                                                      gpu=torch.cuda.get_device_name(), assets=records), indent=2))
(out / 'gen.json').write_text(json.dumps(dict(model='Hunyuan3D-2mini shape + Hunyuan3D-2 paint-v2-0-turbo', seed=2026,
                                              gpu=torch.cuda.get_device_name(), assets=records), indent=2))
print('GEN_COMPLETE', group, round(time.monotonic() - t0, 1), flush=True)
