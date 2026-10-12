#!/usr/bin/env python3
"""把 Grok 生成的原圖（洋紅或黑色底）處理成遊戲用的 assets/*.png。

用法：python3 tools/pie-phoebe/process_assets.py <原圖資料夾> <輸出資料夾>
A 類（洋紅底）：從邊界做洪水填色去背（不會挖掉主體內部的粉紅），裁切、縮小、量化成 256 色。
B 類（黑底）：特效，用加亮混合，黑色即透明，只需裁切縮小。星光額外加圓形遮罩去掉外圈。
地板：縮成 512 方形，遊戲裡用鏡射平鋪。
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SPRITES = {  # 名稱: 最長邊像素
    'phoebe': 512, 'reggie_closed': 512, 'reggie_open': 512,
    'enemy_hum': 320, 'enemy_bat': 320, 'enemy_golem': 384, 'enemy_shooter': 320, 'enemy_boss': 640,
    'fish_blue': 192, 'fish_gold': 192, 'heart': 160, 'chest': 224, 'decor_crystal': 192, 'decor_grass': 192,
}
FX = {'fx_star': 256, 'fx_mirror': 256, 'fx_shot': 128}
GROUND = {'ground': 512}


def key_magenta(im: Image.Image) -> Image.Image:
    im = im.convert('RGB')
    r, g, b = im.split()
    # 候選背景：紅、藍高，綠低
    cand = ImageChops.multiply(ImageChops.multiply(r.point(lambda v: 255 if v > 190 else 0), b.point(lambda v: 255 if v > 190 else 0)),
                               g.point(lambda v: 255 if v < 110 else 0))
    w, h = im.size
    flood = cand.copy()
    for pt in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        if flood.getpixel(pt) == 255:
            ImageDraw.floodfill(flood, pt, 128)
    bg = flood.point(lambda v: 255 if v == 128 else 0)
    bg = bg.filter(ImageFilter.MaxFilter(3))  # 往內吃掉一圈洋紅邊
    alpha = ImageChops.invert(bg).filter(ImageFilter.GaussianBlur(0.7))
    out = im.convert('RGBA')
    out.putalpha(alpha)
    return out


def crop_resize(im: Image.Image, size: int, pad: int = 6) -> Image.Image:
    bbox = im.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(im, (pad, pad))
    return canvas


def main(src: Path, dst: Path):
    dst.mkdir(parents=True, exist_ok=True)
    for name, size in SPRITES.items():
        out = crop_resize(key_magenta(Image.open(src / f'{name}.png')), size)
        out = out.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
        out.save(dst / f'{name}.png', optimize=True)
        print(name, out.size)
    for name, size in FX.items():
        im = Image.open(src / f'{name}.png').convert('RGB')
        s = min(im.size)
        im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2)).resize((size, size), Image.LANCZOS)
        if name == 'fx_star':  # 只留中心的星芒，去掉外圈光環
            mask = Image.new('L', im.size, 0)
            d = ImageDraw.Draw(mask)
            d.ellipse([size * 0.15, size * 0.15, size * 0.85, size * 0.85], fill=255)
            mask = mask.filter(ImageFilter.GaussianBlur(size * 0.07))
            im = ImageChops.multiply(im, Image.merge('RGB', (mask, mask, mask)))
        im.save(dst / f'{name}.png', optimize=True)
        print(name, im.size)
    for name, size in GROUND.items():
        im = Image.open(src / f'{name}.png').convert('RGB').resize((size, size), Image.LANCZOS)
        im.save(dst / f'{name}.png', optimize=True)
        print(name, im.size)


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
