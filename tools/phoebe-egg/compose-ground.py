"""Compose the 96x96 world-unit ground map from Grok's seamless grass/sand tiles (run before build-terrain.mjs)."""
import math, pathlib
import numpy as np
from PIL import Image, ImageFilter
here = pathlib.Path(__file__).parent / 'textures'
N, SPAN = 4096, 96.0
def tiled(name, reps):
    t = np.asarray(Image.open(here / name).convert('RGB').resize((N // reps, N // reps), Image.LANCZOS))
    return np.tile(t, (reps, reps, 1)).astype(np.float32)
grass, sand = tiled('grass.png', 8), tiled('sand.png', 4)
ys, xs = np.mgrid[0:N, 0:N].astype(np.float32)
x, z = (xs / N - .5) * SPAN, (ys / N - .5) * SPAN
rng = np.random.default_rng(7)
noise = np.asarray(Image.fromarray((rng.random((64, 64)) * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)).astype(np.float32) / 255 - .5
d_path = np.abs(x - (9 + np.sin(z * .15) * 3)) - 2.7 + noise * 1.4
path = np.where(np.abs(z) < 27, d_path, 9)
d_camp = np.hypot(x - 0, z - 23) - 5.2 + noise * 1.0
d_nest = np.hypot(x - 0, z + 23) - 5.2 + noise * 1.0
d_beach = 41.2 - np.hypot(x, z) + noise * 2.2
d = np.minimum.reduce([path, d_camp, d_nest, d_beach])
mask = np.clip(.5 - d / 1.1, 0, 1)[..., None]
out = grass * (1 - mask) + sand * mask
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(here / 'ground-composite.png', optimize=True)
print('ground-composite.png', N)
for name in ('ground-composite', 'cliff', 'water', 'sky'):   # terrain GLBs embed JPEG to stay small
    Image.open(here / f'{name}.png').convert('RGB').save(here / f'{name}.jpg', quality=86, optimize=True)
