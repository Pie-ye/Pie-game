import subprocess, os, sys
def sh(c): 
    print('+', c, flush=True); subprocess.run(c, shell=True, check=False)
os.makedirs('/content/lora', exist_ok=True)
sh('cd /content && [ -d ComfyUI ] || git clone --depth 1 https://github.com/comfyanonymous/ComfyUI')
sh('cd /content/ComfyUI && pip install -q -r requirements.txt 2>&1 | tail -3')
base='https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files'
for sub, name, dst in [('diffusion_models','anima-base-v1.0.safetensors','diffusion_models'),('text_encoders','qwen_3_06b_base.safetensors','text_encoders'),('vae','qwen_image_vae.safetensors','vae')]:
    sh(f'mkdir -p /content/ComfyUI/models/{dst} && [ -f /content/ComfyUI/models/{dst}/{name} ] || wget -q -O /content/ComfyUI/models/{dst}/{name} {base}/{sub}/{name}')
sh('mkdir -p /content/ComfyUI/models/loras; ls -la /content/ComfyUI/models/*/ | head -30')
sh('nvidia-smi --query-gpu=name,memory.total --format=csv')
print('SETUP DONE', flush=True)
