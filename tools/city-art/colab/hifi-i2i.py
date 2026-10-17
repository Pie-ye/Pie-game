"""Hi-Fi Rush LoRA img2img（Colab）：以一張角色圖為底，用不同姿勢提示詞產走路關鍵格。
usage: python hifi-i2i.py jobs.json   jobs: {"init":"/content/hero_5.png","items":[{"name","prompt","strength":0.55,"seeds":[..],"lora":0.9}]}
輸出 /content/walk_out/<name>_<seed>.png 與去背版 _cut.png。"""
import json, pathlib, subprocess, sys, time
subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', 'torchao'], check=False)
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'diffusers>=0.32', 'transformers', 'accelerate', 'safetensors', 'peft', 'rembg', 'onnxruntime'], check=False)
import torch
from PIL import Image
from diffusers import StableDiffusionXLPipeline, StableDiffusionXLImg2ImgPipeline, EulerAncestralDiscreteScheduler
spec = json.load(open(sys.argv[1])); out = pathlib.Path('/content/walk_out'); out.mkdir(exist_ok=True)
base = StableDiffusionXLPipeline.from_pretrained('cagliostrolab/animagine-xl-4.0', torch_dtype=torch.float16, use_safetensors=True)
exec(open('/content/hifi-lora.py').read())
base_pipe = base
base_pipe.to('cuda')
set_lora = install_lora(base_pipe, '/content/loras/Hi-Fi_Rush_Style_Illustrious-000016.safetensors')
pipe = StableDiffusionXLImg2ImgPipeline(**base.components)
pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
pipe.vae.enable_slicing(); pipe.vae.enable_tiling()
init = Image.open(spec['init']).convert('RGB')
from rembg import new_session, remove
cut = new_session('isnet-general-use')
NEG = 'lowres, bad anatomy, text, watermark, realistic, photo, blurry, cropped, multiple views, two characters, extra limbs, background scenery'
t0 = time.monotonic()
for it in spec['items']:
    set_lora(it.get('lora', .9))
    for seed in it.get('seeds', [1, 2, 3]):
        f = out / f"{it['name']}_{seed}.png"
        if f.exists(): continue
        img = pipe(prompt='hifirushstyle, ' + it['prompt'] + ', masterpiece, best quality', negative_prompt=NEG, image=init, strength=it.get('strength', .55),
                   num_inference_steps=30, guidance_scale=6.0, generator=torch.Generator('cuda').manual_seed(seed)).images[0]
        img.save(f); remove(img, session=cut).save(out / f"{it['name']}_{seed}_cut.png")
        print(f"{time.monotonic() - t0:6.0f}s {f.name}", flush=True)
print('ALL DONE', flush=True)
