"""Animagine XL 4.0 + 多顆 LoRA 批次生圖（小島動漫畫風）。
用法：python island-gen.py jobs.json [...]
jobs: {"items":[{"name","prompt","neg","seeds":[..],"w","h","loras":{"pe":0.8,"shinkai":0.6,"village":0.45},
                 "tile":"none|xy|x","steps":28,"cfg":6}]}
tile=xy：卷積改成循環填補，產生可無縫平鋪的貼圖；tile=x：只有左右循環（天空全景）。
輸出 /content/island_out/<name>_<seed>.png（已存在就跳過）。"""
import json, pathlib, sys, time
import torch, torch.nn.functional as F
from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler
from safetensors.torch import load_file, save_file

COMMON_NEG = ('lowres, worst quality, low quality, low score, bad score, average score, jpeg artifacts, signature, watermark, username, text, logo, letters, '
              'blurry, photo, photorealistic, realistic, 3d render, cgi, unreal engine, neon, pure black outline, thick outline, flat cel shading, dark, night, snow, mountain, crowd')
HEAD = 'masterpiece, high score, great score, absurdres, '
out = pathlib.Path('/content/island_out'); out.mkdir(exist_ok=True)
items = [i for f in sys.argv[1:] for i in json.load(open(f))['items']]

pipe = StableDiffusionXLPipeline.from_pretrained('cagliostrolab/animagine-xl-4.0', torch_dtype=torch.float16, use_safetensors=True)
pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
LORAS = {'pe': 'PE_AnimeBG.safetensors', 'shinkai': 'Shinkai.safetensors', 'village': 'Mountain_village_fantasy.safetensors'}
loaded = []
for name, fn in LORAS.items():
    p = pathlib.Path('/content/loras') / fn
    if not p.exists(): print('missing lora', fn, flush=True); continue
    for mode in ('full', 'unet'):
        try:
            sd = load_file(str(p))
            if mode == 'unet': sd = {k: v for k, v in sd.items() if k.startswith('lora_unet_')}
            save_file(sd, f'/content/loras/_{name}_{mode}.safetensors')
            pipe.load_lora_weights('/content/loras', weight_name=f'_{name}_{mode}.safetensors', adapter_name=name)
            loaded.append(name); print('LoRA loaded', name, mode, flush=True); break
        except Exception as e:
            print('LoRA load failed', name, mode, repr(e)[:200], flush=True)
pipe.to('cuda')

# 循環填補：tile 模式時讓所有 Conv2d 在邊界循環
convs = [m for m in list(pipe.unet.modules()) + list(pipe.vae.modules()) if isinstance(m, torch.nn.Conv2d)]
def set_tile(mode):
    for m in convs:
        if not hasattr(m, '_orig_forward'): m._orig_forward = m._conv_forward
        if mode == 'none' or m.padding == (0, 0):
            m._conv_forward = m._orig_forward; continue
        ph, pw = m.padding
        def fwd(inp, weight, bias, m=m, ph=ph, pw=pw, mode=mode):
            x = F.pad(inp, (pw, pw, 0, 0), mode='circular')
            x = F.pad(x, (0, 0, ph, ph), mode='circular' if mode == 'xy' else 'constant')
            return F.conv2d(x, weight, bias, m.stride, 0, m.dilation, m.groups)
        m._conv_forward = fwd

t0 = time.monotonic()
for it in items:
    ws = {k: v for k, v in it.get('loras', {}).items() if k in loaded}
    if ws: pipe.set_adapters(list(ws), adapter_weights=list(ws.values()))
    else: pipe.disable_lora()
    if ws: pipe.enable_lora()
    set_tile(it.get('tile', 'none'))
    neg = COMMON_NEG + (', ' + it['neg'] if it.get('neg') else '')
    for seed in it.get('seeds', [1, 2]):
        f = out / f"{it['name']}_{seed}.png"
        if f.exists(): continue
        img = pipe(prompt=HEAD + it['prompt'], negative_prompt=neg, width=it.get('w', 1024), height=it.get('h', 1024),
                   num_inference_steps=it.get('steps', 28), guidance_scale=it.get('cfg', 6.0), clip_skip=2,
                   generator=torch.Generator('cuda').manual_seed(seed)).images[0]
        img.save(f); print(f"{time.monotonic() - t0:7.0f}s {f.name}", flush=True)
print('ALL DONE', flush=True)
