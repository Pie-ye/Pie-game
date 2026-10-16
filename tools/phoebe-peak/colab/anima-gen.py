"""Batch text->image with Anima + LoRA through a local ComfyUI server (started on demand).
usage: python anima-gen.py jobs.json   jobs: {"lora":"x.safetensors","items":[{"name","prompt","seeds":[..],"w","h","lora":1.0,"steps":30,"cfg":4.5}]}
Outputs /content/anima_out/<name>_<seed>.png (skips existing)."""
import json, os, subprocess, sys, time, urllib.request, urllib.parse
API = 'http://127.0.0.1:8188'; OUT = '/content/anima_out'; os.makedirs(OUT, exist_ok=True)
NEG = 'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration, realistic, 3d, multiple views, character sheet, text, watermark, background'
def up():
    try: urllib.request.urlopen(API + '/system_stats', timeout=2); return True
    except Exception: return False
if not up():
    subprocess.Popen('cd /content/ComfyUI && nohup python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch > /content/comfy.log 2>&1 &', shell=True)
    for _ in range(240):
        if up(): break
        time.sleep(2)
    else: raise SystemExit('ComfyUI did not start')
def post(path, data):
    return json.loads(urllib.request.urlopen(urllib.request.Request(API + path, json.dumps(data).encode(), {'Content-Type': 'application/json'}), timeout=60).read())
def workflow(it, seed, lora):
    wf = {'1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'anima-base-v1.0.safetensors', 'weight_dtype': 'default'}},
          '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_3_06b_base.safetensors', 'type': 'stable_diffusion'}},
          '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'qwen_image_vae.safetensors'}},
          '5': {'class_type': 'CLIPTextEncode', 'inputs': {'text': it['prompt'], 'clip': ['2', 0]}},
          '6': {'class_type': 'CLIPTextEncode', 'inputs': {'text': it.get('negative', NEG), 'clip': ['2', 0]}},
          '7': {'class_type': 'EmptySD3LatentImage', 'inputs': {'width': it.get('w', 1024), 'height': it.get('h', 1024), 'batch_size': 1}},
          '9': {'class_type': 'VAEDecode', 'inputs': {'samples': ['8', 0], 'vae': ['3', 0]}},
          '10': {'class_type': 'SaveImage', 'inputs': {'images': ['9', 0], 'filename_prefix': 'job'}}}
    model = ['1', 0]
    if it.get('lora', 1.0) > 0:
        wf['4'] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['1', 0], 'lora_name': lora, 'strength_model': it.get('lora', 1.0)}}; model = ['4', 0]
    wf['8'] = {'class_type': 'KSampler', 'inputs': {'model': model, 'seed': seed, 'steps': it.get('steps', 30), 'cfg': it.get('cfg', 4.5), 'sampler_name': it.get('sampler', 'er_sde'),
               'scheduler': it.get('scheduler', 'simple'), 'positive': ['5', 0], 'negative': ['6', 0], 'latent_image': ['7', 0], 'denoise': 1.0}}
    return wf
spec = json.load(open(sys.argv[1])); t0 = time.time()
for it in spec['items']:
    for seed in it.get('seeds', [1]):
        f = f"{OUT}/{it['name']}_{seed}.png"
        if os.path.exists(f): continue
        pid = post('/prompt', {'prompt': workflow(it, seed, spec.get('lora', 'phoebe_chibi_anima_v1.safetensors'))})['prompt_id']
        while True:
            h = json.loads(urllib.request.urlopen(f'{API}/history/{pid}', timeout=30).read())
            if pid in h: break
            time.sleep(1)
        e = h[pid]
        if e.get('status', {}).get('status_str') == 'error': print('ERROR', json.dumps(e['status'])[:600], flush=True); continue
        img = next(iter(e['outputs'].values()))['images'][0]
        open(f, 'wb').write(urllib.request.urlopen(f"{API}/view?" + urllib.parse.urlencode(img), timeout=60).read()); print(f'{time.time()-t0:6.0f}s {os.path.basename(f)}', flush=True)
print('ALL DONE', flush=True)
