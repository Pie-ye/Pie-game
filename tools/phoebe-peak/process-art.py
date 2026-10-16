"""Turn the chosen LoRA renders into game assets.
usage: process-art.py sky <dir-with-png> <out-dir>      skies: pick table below, seam-blended and resized to 2048x1024 JPEG
       process-art.py tex <dir-with-png> <out-dir> ...  cliff/ground textures: centre crop, 512x512 JPEG"""
import pathlib, sys
import numpy as np
from PIL import Image, ImageFilter
SKY = {'sky_beach': 'sky_beach_1', 'sky_jungle': 'sky_jungle_1', 'sky_alpine': 'sky_alpine_2', 'sky_caldera': 'sky_caldera_2', 'sky_forge': 'sky_forge_1', 'sky_citadel': 'sky_citadel_1'}
def seamless(im, fraction=.12):
    a = np.asarray(im.convert('RGB')).astype(np.float32); h, w, _ = a.shape; n = int(w * fraction)
    out = a[:, :w - n].copy(); t = np.linspace(0, 1, n)[None, :, None]
    out[:, :n] = a[:, :n] * t + a[:, w - n:] * (1 - t)       # left edge continues into the tail, so x=0 and x=w'-1 are neighbours
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
def main():
    kind, src, dst = sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]); dst.mkdir(parents=True, exist_ok=True)
    if kind == 'sky':
        for name, pick in SKY.items():
            im = seamless(Image.open(src / f'{pick}.png')).resize((2048, 1024), Image.LANCZOS); im.save(dst / f'{name}.jpg', quality=86, optimize=True); print(name, '<-', pick)
    elif kind == 'tex':
        picks = dict(a.split('=') for a in sys.argv[4:])          # wall_beach=w2_beach_2[:x0,y0,x1,y1 fractions]
        for name, spec in picks.items():
            pick, _, box = spec.partition(':'); im = Image.open(src / f'{pick}.png').convert('RGB'); W, H = im.size
            x0, y0, x1, y1 = [float(v) for v in box.split(',')] if box else (.1, .1, .9, .9)
            im = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))).resize((512, 512), Image.LANCZOS)
            a = np.asarray(im).astype(np.float32) + 1; low = np.asarray(im.filter(ImageFilter.GaussianBlur(120))).astype(np.float32) + 1   # remove the vignette: divide by the low-pass light
            a = np.clip(a * (low.mean(axis=(0, 1), keepdims=True) / low) ** .75, 0, 255)
            Image.fromarray(a.astype(np.uint8)).save(dst / f'{name}.jpg', quality=88, optimize=True); print(name, '<-', spec)
main()
