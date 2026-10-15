"""Turn white-background Grok item renders into 96px transparent HUD icons (assets/icons/<kind>.png)."""
import sys, pathlib
import numpy as np
from PIL import Image
from scipy import ndimage
src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]); dst.mkdir(parents=True, exist_ok=True)
for f in sorted(src.glob('*.png')):
    im = Image.open(f).convert('RGB'); a = np.asarray(im).astype(int)
    near_white = (255 - a).max(axis=2) < 22
    lab, n = ndimage.label(near_white)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    alpha = np.asarray(Image.fromarray(alpha).filter(__import__('PIL.ImageFilter', fromlist=['x']).GaussianBlur(1.0)))
    rgba = np.dstack([a.astype(np.uint8), alpha]); out = Image.fromarray(rgba, 'RGBA')
    bbox = out.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    if bbox: out = out.crop(bbox)
    side = max(out.size); canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0)); canvas.paste(out, ((side - out.width) // 2, (side - out.height) // 2))
    canvas.resize((96, 96), Image.LANCZOS).save(dst / f.name, optimize=True); print(f.stem, end=' ')
