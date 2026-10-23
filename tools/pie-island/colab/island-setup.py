"""小島動漫畫風生圖環境（Colab L4，系統 python）：diffusers + Animagine XL 4.0 + 兩顆網路 LoRA。
本機的 Mountain_village_fantasy 另外用 upload-lora.sh 上傳到 /content/loras/。"""
import subprocess, sys, pathlib, urllib.request
subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'torchao'], check=False)
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'diffusers>=0.32', 'transformers', 'accelerate', 'safetensors', 'peft'], check=True)
d = pathlib.Path('/content/loras'); d.mkdir(exist_ok=True)
for name, url in [('PE_AnimeBG.safetensors', 'https://huggingface.co/rajkumaralma/pe_anime-background/resolve/main/PE_AnimeBG.safetensors'),
                  ('Shinkai.safetensors', 'https://civitai.com/api/download/models/153903')]:
    f = d / name
    if not f.exists() or f.stat().st_size < 1e6:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as r, open(f, 'wb') as o:
            while True:
                b = r.read(1 << 20)
                if not b: break
                o.write(b)
    print(name, f.stat().st_size, flush=True)
from huggingface_hub import snapshot_download
snapshot_download('cagliostrolab/animagine-xl-4.0', allow_patterns=['*.json', '*.txt', '*.safetensors'], ignore_patterns=['animagine-xl-4.0.safetensors'])
print('ISLAND_SETUP_COMPLETE', flush=True)
