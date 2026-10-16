"""Animagine XL 4.0 + Mountain_village_fantasy LoRA batch generator (Colab, system python).
usage: python sdxl-gen.py jobs.json   jobs: {"items":[{"name","prompt","seeds":[..],"w","h","lora":0.7,"bg":"white|scene","steps":26,"cfg":6}]}
Outputs /content/env_out/<name>_<seed>.png (skips existing)."""
import json, pathlib, subprocess, sys, time
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'diffusers>=0.32', 'transformers', 'accelerate', 'safetensors', 'peft'], check=False)
import torch
from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler
specs = [json.load(open(f)) for f in sys.argv[1:]]; out = pathlib.Path('/content/env_out'); out.mkdir(exist_ok=True)
NEG_BG = ('lowres, bad anatomy, text, watermark, signature, realistic, photo, blurry, cropped, out of frame, multiple views, collage, grid, lineup, set, '
          'character, person, girl, 1girl, background scenery, landscape, ground, floor, shadow on ground, frame, border, gradient background, ui, logo')
NEG_SCENE = 'lowres, text, watermark, signature, blurry, jpeg artifacts, person, character, 1girl, 1boy, ui, logo, frame, border, cropped'
pipe = StableDiffusionXLPipeline.from_pretrained('cagliostrolab/animagine-xl-4.0', torch_dtype=torch.float16, use_safetensors=True)
pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
from safetensors.torch import load_file, save_file
sd = load_file('/content/loras/Mountain_village_fantasy.safetensors')
print('lora keys', len(sd), 'unet', sum(k.startswith('lora_unet_') for k in sd), flush=True)
for mode in ('full', 'unet'):
    try:
        use = sd if mode == 'full' else {k: v for k, v in sd.items() if k.startswith('lora_unet_')}
        save_file(use, f'/content/loras/mv_{mode}.safetensors')
        pipe.load_lora_weights('/content/loras', weight_name=f'mv_{mode}.safetensors', adapter_name='mv'); print('LoRA loaded', mode, flush=True); break
    except Exception as e: print('LoRA load failed', mode, repr(e)[:200], flush=True)
pipe.to('cuda'); pipe.vae.enable_slicing(); pipe.vae.enable_tiling()
t0 = time.monotonic(); cur = None
for it in [i for sp in specs for i in sp['items']]:
    w = it.get('lora', .7)
    pipe.set_adapters(['mv'], adapter_weights=[w])
    bg = it.get('bg', 'white')
    prompt = it['prompt'] + (', simple background, white background, plain white background, isolated object, single subject, centered, full object visible' if bg == 'white' else '') + ', masterpiece, high score, great score, absurdres'
    for seed in it.get('seeds', [1, 2]):
        f = out / f"{it['name']}_{seed}.png"
        if f.exists(): continue
        img = pipe(prompt=prompt, negative_prompt=(NEG_BG if bg == 'white' else NEG_SCENE) + (', ' + it['neg'] if it.get('neg') else ''), width=it.get('w', 1024), height=it.get('h', 1024),
                   num_inference_steps=it.get('steps', 26), guidance_scale=it.get('cfg', 6.0), generator=torch.Generator('cuda').manual_seed(seed)).images[0]
        img.save(f); print(f"{time.monotonic() - t0:7.0f}s {f.name}", flush=True)
print('ALL DONE', flush=True)
