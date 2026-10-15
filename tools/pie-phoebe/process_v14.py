#!/usr/bin/env python3
"""把 Colab（Animagine XL）生成的 v1.4 原圖處理成遊戲素材。

用法：python3 tools/pie-phoebe/process_v14.py <原圖資料夾> <輸出資料夾> [名稱=檔名 ...]
未指定的名稱使用 CHOICES 裡預設挑選的候選圖。背景是接近純色的白或灰藍，從四邊做容差洪水填色去背。
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

# 名稱: (預設候選檔名, 最長邊像素)
CHOICES = {
    'enemy_vanguard': ('v2_vanguard_14.png', 640),
    'enemy_weaver': ('v2_weaver_13.png', 640),
    'enemy_conductor': ('v2_conductor_16.png', 640),
    'enemy_crab': ('v2_crab_15.png', 576),
    'enemy_lighthouse': ('v2_lighthouse_16.png', 576),
    'enemy_hive': ('v2_hive_12.png', 576),
    'enemy_obelisk': ('v2_pillar_14.png', 320),
    'enemy_egg': ('v2_egg_12.png', 256),
    'hecate': ('v2_hecate_12.png', 512),
    'phrolova': ('phrolova_front.png', 512),   # 圖庫裡的弗洛洛 Q 版（tools/pie-phoebe/refs/phrolova_chibi_front.png）
}
MARK = (255, 0, 255)


def cutout(im: Image.Image, thresh: int = 34) -> Image.Image:
    im = im.convert('RGB')
    work = im.copy()
    w, h = work.size
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for pt in seeds:
        if work.getpixel(pt) != MARK:
            ImageDraw.floodfill(work, pt, MARK, thresh=thresh)
    r, g, b = work.split()
    bg = ImageChops.multiply(ImageChops.multiply(r.point(lambda v: 255 if v == 255 else 0), g.point(lambda v: 255 if v == 0 else 0)),
                             b.point(lambda v: 255 if v == 255 else 0))
    bg = bg.filter(ImageFilter.MaxFilter(3))
    alpha = ImageChops.invert(bg).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert('RGBA')
    out.putalpha(alpha)
    return out


def crop_resize(im: Image.Image, size: int, pad: int = 6) -> Image.Image:
    bbox = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(im, (pad, pad))
    return canvas


def make_fx_lily(src: Path, dst: Path):
    """黑底彼岸花特效：取中心正方形、縮成 256、加圓形柔邊遮罩（加亮混合用）。"""
    f = src / 'fx_lily_1.png'
    if not f.exists():
        return
    im = Image.open(f).convert('RGB')
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((256, 256), Image.LANCZOS)
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse([256 * .10, 256 * .10, 256 * .90, 256 * .90], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(18))
    im = ImageChops.multiply(im, Image.merge('RGB', (mask, mask, mask)))
    im.save(dst / 'fx_lily.png', optimize=True)
    print('fx_lily', im.size)


def main(src: Path, dst: Path, overrides: dict):
    dst.mkdir(parents=True, exist_ok=True)
    for name, (default, size) in CHOICES.items():
        f = src / overrides.get(name, default)
        if not f.exists():
            print('略過（找不到）', f); continue
        out = crop_resize(cutout(Image.open(f)), size)
        out = out.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
        out.save(dst / f'{name}.png', optimize=True)
        print(name, out.size, f.name)
    make_fx_lily(src, dst)


if __name__ == '__main__':
    ov = dict(a.split('=', 1) for a in sys.argv[3:])
    main(Path(sys.argv[1]), Path(sys.argv[2]), ov)
