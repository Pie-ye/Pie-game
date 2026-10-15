#!/usr/bin/env python3
"""Turn Grok output into game-ready assets: seamless 512px texture JPGs, equirect skies, HUD icons and portraits.

  python3 process_assets.py <grok-root> <game-assets-dir>
  grok-root has chars/out, items/out, tex/out (as produced by the grok-*.md prompts).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

root, dest = Path(sys.argv[1]), Path(sys.argv[2])
(dest / 'tex').mkdir(parents=True, exist_ok=True); (dest / 'ui').mkdir(parents=True, exist_ok=True)


def seamless(img: Image.Image) -> Image.Image:
    """Cross-fade the tile with itself shifted by half so left/right and top/bottom edges match."""
    a = np.asarray(img.convert('RGB'), dtype=np.float32)
    h, w, _ = a.shape
    mx = 1 - np.abs(np.linspace(-1, 1, w))[None, :, None]
    a = a * mx + np.roll(a, w // 2, axis=1) * (1 - mx)
    my = 1 - np.abs(np.linspace(-1, 1, h))[:, None, None]
    a = a * my + np.roll(a, h // 2, axis=0) * (1 - my)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


for f in sorted((root / 'tex/out').glob('*.png')):
    im = Image.open(f).convert('RGB')
    if f.stem.startswith('sky_'):
        flip = im.transpose(Image.FLIP_LEFT_RIGHT)
        both = Image.new('RGB', (im.width * 2, im.height)); both.paste(im, (0, 0)); both.paste(flip, (im.width, 0))
        both.resize((2048, 1024), Image.LANCZOS).save(dest / 'tex' / f'{f.stem}.jpg', quality=82)
    else:
        out = seamless(im.resize((512, 512), Image.LANCZOS)) if f.stem != 'wood_plank' else im.resize((512, 512), Image.LANCZOS)
        out.save(dest / 'tex' / f'{f.stem}.jpg', quality=84)
    print('tex', f.stem)

for f in sorted((root / 'items/out').glob('*.png')):
    im = Image.open(f).convert('RGB')
    s = max(im.size); sq = Image.new('RGB', (s, s), (255, 255, 255)); sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    sq.resize((96, 96), Image.LANCZOS).save(dest / 'ui' / f'{f.stem}.jpg', quality=88)
for name, box in (('phoebe', (0.12, 0.05, 0.88, 0.56)), ('fluorolo', (0.14, 0.05, 0.86, 0.52))):
    src = root / 'chars/out' / f'{name}_apose.png'
    if not src.exists(): continue
    im = Image.open(src).convert('RGB'); w, h = im.size
    crop = im.crop((int(w * box[0]), int(h * box[1]), int(w * box[2]), int(h * box[3])))
    s = max(crop.size); sq = Image.new('RGB', (s, s), (255, 255, 255)); sq.paste(crop, ((s - crop.width) // 2, (s - crop.height) // 2))
    sq.resize((192, 192), Image.LANCZOS).save(dest / 'ui' / f'{name}.jpg', quality=88)
print('done')
