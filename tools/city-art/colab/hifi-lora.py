"""kohya 格式 LoRA 直接合併進 SDXL 權重（diffusers 的 load_lora_weights 對這份檔案在新版會 IndexError）。
用法：set_lora = install_lora(pipe, '/content/loras/xxx.safetensors'); set_lora(0.8) 之後再出圖。"""
import torch
from safetensors.torch import load_file


def install_lora(pipe, path):
    lora = load_file(path)
    targets = {}
    for prefix, model in (('lora_unet_', pipe.unet), ('lora_te1_', pipe.text_encoder), ('lora_te2_', pipe.text_encoder_2)):
        if model is None:
            continue
        for name, mod in model.named_modules():
            if isinstance(mod, (torch.nn.Linear, torch.nn.Conv2d)):
                key = prefix + name.replace('.', '_')
                if key + '.lora_down.weight' in lora:
                    targets[key] = mod
    originals = {k: m.weight.data.clone() for k, m in targets.items()}
    print('lora layers', len(targets), 'of', len([k for k in lora if k.endswith('.lora_down.weight')]), flush=True)

    def set_lora(weight):
        for key, mod in targets.items():
            down = lora[key + '.lora_down.weight'].float().to(mod.weight.device)
            up = lora[key + '.lora_up.weight'].float().to(mod.weight.device)
            rank = down.shape[0]
            alpha = float(lora[key + '.alpha']) if key + '.alpha' in lora else rank
            delta = (up.flatten(1) @ down.flatten(1)).reshape(mod.weight.shape) * (alpha / rank)
            mod.weight.data = (originals[key].float() + weight * delta).to(mod.weight.dtype)
    return set_lora
