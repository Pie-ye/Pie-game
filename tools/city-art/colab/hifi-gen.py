"""Hi-Fi Rush LoRA (SDXL / Illustrious) batch generator for Colab.
usage: python hifi-gen.py jobs.json [...]
jobs: {"items":[{"name","prompt","neg?","seeds":[..],"w":1024,"h":1024,"lora":0.8,"steps":28,"cfg":5.5,"cut":false}]}
Outputs /content/city_out/<name>_<seed>.png (skips existing); cut=true also writes <name>_<seed>_cut.png via rembg.
Trigger word: hifirushstyle. Base: tries Illustrious-XL, falls back to Animagine XL 4.0."""
import json, pathlib, subprocess, sys, time
subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', 'torchao'], check=False)
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'diffusers>=0.32', 'transformers', 'accelerate', 'safetensors', 'peft', 'rembg', 'onnxruntime'], check=False)
import torch
from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler
specs = [json.load(open(f)) for f in sys.argv[1:]]
out = pathlib.Path('/content/city_out'); out.mkdir(exist_ok=True)
pipe = None
for kind, ref in (('file', ('OnomaAIResearch/Illustrious-xl-early-release-v0', 'Illustrious-XL-earlyaccess-v0.1.safetensors')),
                  ('repo', 'cagliostrolab/animagine-xl-4.0')):
    try:
        if kind == 'file':
            from huggingface_hub import hf_hub_download
            p = hf_hub_download(*ref)
            pipe = StableDiffusionXLPipeline.from_single_file(p, torch_dtype=torch.float16)
        else:
            pipe = StableDiffusionXLPipeline.from_pretrained(ref, torch_dtype=torch.float16, use_safetensors=True)
        print('BASE', ref, flush=True); break
    except Exception as e:
        print('base failed', ref, repr(e)[:200], flush=True)
pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
exec(open('/content/hifi-lora.py').read())
base_pipe = pipe
base_pipe.to('cuda')
set_lora = install_lora(base_pipe, '/content/loras/Hi-Fi_Rush_Style_Illustrious-000016.safetensors')
pipe.vae.enable_slicing(); pipe.vae.enable_tiling()
NEG = 'lowres, bad anatomy, text, watermark, signature, logo, letters, realistic, photo, blurry, jpeg artifacts, cropped, out of frame, worst quality, low quality'
cut_session = None
t0 = time.monotonic()
for it in [i for sp in specs for i in sp['items']]:
    set_lora(it.get('lora', .8))
    prompt = f"hifirushstyle, {it['prompt']}, masterpiece, best quality, absurdres"
    for seed in it.get('seeds', [1, 2]):
        f = out / f"{it['name']}_{seed}.png"
        if f.exists(): continue
        img = pipe(prompt=prompt, negative_prompt=NEG + (', ' + it['neg'] if it.get('neg') else ''), width=it.get('w', 1024), height=it.get('h', 1024),
                   num_inference_steps=it.get('steps', 28), guidance_scale=it.get('cfg', 5.5), generator=torch.Generator('cuda').manual_seed(seed)).images[0]
        img.save(f)
        if it.get('cut'):
            if cut_session is None:
                from rembg import new_session; cut_session = new_session('isnet-general-use')
            from rembg import remove
            remove(img, session=cut_session).save(out / f"{it['name']}_{seed}_cut.png")
        print(f"{time.monotonic() - t0:7.0f}s {f.name}", flush=True)
print('ALL DONE', flush=True)
