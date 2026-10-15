"""在 Colab GPU 上用 Animagine XL 4.0（SDXL 動漫模型）批次生成 2D 遊戲素材。

遠端執行：先把 prompts-<組別>.json 放到 /content/pp/，然後
  nohup python -u /content/pp/colab-img.py <組別> > /content/pp/gen-<組別>.log 2>&1 &
輸出：/content/pp/out/<名稱>_<seed>.png，已存在的檔案會略過（可重跑）。
prompts JSON：{"items": [{"name": "...", "prompt": "...", "bg": "magenta|black", "seeds": [1,2,3]}]}
"""
import json, pathlib, subprocess, sys, time

subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'diffusers>=0.32', 'transformers', 'accelerate', 'safetensors'], check=False)
import torch
from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler

group = sys.argv[1]
root = pathlib.Path('/content/pp')
out = root / 'out'
out.mkdir(parents=True, exist_ok=True)
spec = json.loads((root / f'prompts-{group}.json').read_text())

STYLE = ('chibi, thick dark navy outline, flat colors, cel shading, clean simple shapes, single subject, no text, no watermark')
NEG = ('lowres, bad anatomy, bad hands, text, watermark, signature, realistic, photo, 3d, blurry, cropped, out of frame, '
       'multiple views, character sheet, collage, pattern, grid, lineup, set, many characters, sticker sheet, background scenery, '
       'ground, floor, shadow on ground, frame, border, gradient background')
BG = {'white': 'simple background, white background, plain white background',
      'magenta': 'solid flat pure magenta background, #FF00FF background, simple background',
      'black': 'pure black background, glowing, additive light effect, no ground'}

pipe = StableDiffusionXLPipeline.from_pretrained('cagliostrolab/animagine-xl-4.0', torch_dtype=torch.float16, use_safetensors=True)
pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
pipe.to('cuda')
pipe.vae.enable_slicing()
t0 = time.monotonic()
for it in spec['items']:
    for seed in it.get('seeds', [1, 2, 3]):
        f = out / f"{it['name']}_{seed}.png"
        if f.exists():
            continue
        bg = BG[it.get('bg', 'white')]
        prompt = f"{it['prompt']}, {STYLE if it.get('bg', 'white') in ('magenta', 'white') else ''}, {bg}, masterpiece, high score, great score, absurdres"
        g = torch.Generator('cuda').manual_seed(seed)
        img = pipe(prompt=prompt, negative_prompt=NEG + (', magenta on subject' if it.get('bg', 'white') in ('magenta', 'white') else ''),
                   width=it.get('w', 1024), height=it.get('h', 1024), num_inference_steps=26, guidance_scale=6.0, generator=g).images[0]
        img.save(f)
        print(f"{time.monotonic() - t0:7.0f}s {f.name}", flush=True)
print('ALL DONE', flush=True)
