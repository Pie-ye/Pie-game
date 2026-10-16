"""ComfyUI + Anima weights on a Colab GPU (system python). Phoebe LoRA is expected in /content/ComfyUI/models/loras."""
import os, pathlib, subprocess
def run(cmd):
    print('+', cmd, flush=True)
    p = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout: print(line, end='', flush=True)
    if p.wait(): raise RuntimeError('failed: ' + cmd)
if not pathlib.Path('/content/ComfyUI').exists(): run('cd /content && git clone --depth 1 https://github.com/comfyanonymous/ComfyUI')
run('cd /content/ComfyUI && pip install -q -r requirements.txt 2>&1 | tail -3')
base = 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files'
for sub, name, dst in [('diffusion_models', 'anima-base-v1.0.safetensors', 'diffusion_models'), ('text_encoders', 'qwen_3_06b_base.safetensors', 'text_encoders'), ('vae', 'qwen_image_vae.safetensors', 'vae')]:
    d = f'/content/ComfyUI/models/{dst}'; os.makedirs(d, exist_ok=True)
    if not pathlib.Path(f'{d}/{name}').exists(): run(f'wget -q -O {d}/{name} {base}/{sub}/{name}')
print('COMFY_SETUP_COMPLETE', flush=True)
