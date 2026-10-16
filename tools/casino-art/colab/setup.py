"""Colab 環境：SD1.5 + diffusers + rembg（去背）。gwentCB01 是 SD1.5 kohya LoRA（觸發詞 gwentcb01_soul3142）。"""
import subprocess, sys
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'diffusers>=0.32', 'transformers', 'accelerate', 'safetensors', 'peft', 'rembg', 'onnxruntime-gpu'], check=False)
import torch
from diffusers import StableDiffusionPipeline
p = StableDiffusionPipeline.from_pretrained('stable-diffusion-v1-5/stable-diffusion-v1-5', torch_dtype=torch.float16, safety_checker=None)
print('base ok', flush=True)
