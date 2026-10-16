"""SD1.5 + gwentCB01 LoRA batch generator (Colab).
usage: python gwent-gen.py jobs.json
jobs: {"items":[{"name","prompt","neg?","seeds":[..],"w":512,"h":512,"lora":0.8,"tile":false,"steps":28,"cfg":7,"cut":false}]}
Outputs /content/art_out/<name>_<seed>.png（已存在就略過）。tile=true 會把所有卷積改成循環 padding，輸出可無縫拼貼。
cut=true 另外用 rembg 去背存成 <name>_<seed>_cut.png。"""
import json, pathlib, subprocess, sys, time
import torch
from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler
TRIGGER = 'gwentcb01_soul3142'
specs = [json.load(open(f)) for f in sys.argv[1:]]
out = pathlib.Path('/content/art_out'); out.mkdir(exist_ok=True)
pipe = StableDiffusionPipeline.from_pretrained('stable-diffusion-v1-5/stable-diffusion-v1-5', torch_dtype=torch.float16, safety_checker=None)
pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True, algorithm_type='dpmsolver++')
pipe.to('cuda'); pipe.vae.enable_slicing()
# kohya 格式的 LoRA 直接合併進權重（diffusers/peft 的轉換器在這份檔案上會失敗）。
from safetensors.torch import load_file
lora = load_file('/content/loras/gwentCB01.safetensors')
targets = {}
for prefix, model in (('lora_unet_', pipe.unet), ('lora_te_', pipe.text_encoder)):
    for name, mod in model.named_modules():
        if isinstance(mod, (torch.nn.Linear, torch.nn.Conv2d)):
            for key in (prefix + name.replace('.', '_'), prefix + 'text_model_' + name.replace('.', '_')):
                if key + '.lora_down.weight' in lora: targets[key] = mod
originals = {k: m.weight.data.clone() for k, m in targets.items()}
print('lora layers', len(targets), 'of', len(lora) // 3, flush=True)
def set_lora(weight):
    for key, mod in targets.items():
        down = lora[key + '.lora_down.weight'].float().cuda(); up = lora[key + '.lora_up.weight'].float().cuda()
        rank = down.shape[0]; alpha = float(lora[key + '.alpha']) if key + '.alpha' in lora else rank
        delta = (up.flatten(1) @ down.flatten(1)).reshape(mod.weight.shape) * (alpha / rank)
        mod.weight.data = (originals[key].float() + weight * delta).to(mod.weight.dtype)
cut_session = None
def set_tile(on):
    for m in list(pipe.unet.modules()) + list(pipe.vae.modules()):
        if isinstance(m, torch.nn.Conv2d): m.padding_mode = 'circular' if on else 'zeros'
NEG = 'text, letters, watermark, signature, logo, lowres, blurry, jpeg artifacts, deformed, ugly, cropped, out of frame, people, face, hands'
te = pipe.text_encoder
fln = getattr(te, 'final_layer_norm', None) or te.text_model.final_layer_norm
def embed(text):
    # clip skip 2：LoRA 是用倒數第二層訓練的；新版 transformers 讓 diffusers 內建的 clip_skip 壞掉，所以自己算。
    ids = pipe.tokenizer(text, padding='max_length', max_length=77, truncation=True, return_tensors='pt').input_ids.cuda()
    with torch.no_grad():
        return fln(te(ids, output_hidden_states=True).hidden_states[-3])
t0 = time.monotonic()
for it in [i for sp in specs for i in sp['items']]:
    set_lora(it.get('lora', .8))
    set_tile(bool(it.get('tile')))
    prompt = f"{TRIGGER}, {it['prompt']}, masterpiece, best quality, highly detailed"
    for seed in it.get('seeds', [1, 2, 3, 4]):
        f = out / f"{it['name']}_{seed}.png"
        if f.exists(): continue
        img = pipe(prompt_embeds=embed(prompt), negative_prompt_embeds=embed(NEG + (', ' + it['neg'] if it.get('neg') else '')),
                   width=it.get('w', 512), height=it.get('h', 512),
                   num_inference_steps=it.get('steps', 28), guidance_scale=it.get('cfg', 7.0),
                   generator=torch.Generator('cuda').manual_seed(seed)).images[0]
        img.save(f)
        if it.get('cut'):
            if cut_session is None:
                from rembg import new_session; cut_session = new_session('isnet-general-use')
            from rembg import remove
            remove(img, session=cut_session).save(out / f"{it['name']}_{seed}_cut.png")
        print(f"{time.monotonic() - t0:7.0f}s {f.name}", flush=True)
print('ALL DONE', flush=True)
