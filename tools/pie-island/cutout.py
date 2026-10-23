#!/usr/bin/env python3
"""設定圖去背（給 Hunyuan3D）：從畫面邊框往內做容差填色，把米白／白底換成透明。
用法：python3 cutout.py <輸入.png> <輸出.png> [容差 40]
Hunyuan 內建的 rembg 會把米白底上的淺色樹葉一起去掉，所以先在本機去背，輸出含透明度的 PNG。"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

src, dst = sys.argv[1:3]
tol = int(sys.argv[3]) if len(sys.argv) > 3 else 40
im = Image.open(src).convert('RGB')
w, h = im.size
key = (255, 0, 255)
work = im.copy()
step = max(8, w // 64)
seeds = [(x, 0) for x in range(0, w, step)] + [(x, h - 1) for x in range(0, w, step)] + [(0, y) for y in range(0, h, step)] + [(w - 1, y) for y in range(0, h, step)]
for sx, sy in seeds:
    if work.getpixel((sx, sy)) != key:
        ImageDraw.floodfill(work, (sx, sy), key, thresh=tol)
# 透明度：填到洋紅色的地方是背景
r, g, b = work.split()
mask = Image.merge('RGB', (r, g, b)).point(lambda v: v)
bg = Image.new('RGB', im.size, key)
diff = ImageChops.difference(work, bg).convert('L').point(lambda v: 255 if v > 8 else 0)
alpha = diff.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
out = im.convert('RGBA'); out.putalpha(alpha)
bbox = alpha.point(lambda v: 255 if v > 32 else 0).getbbox()
cover = 0 if not bbox else (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) / (w * h)
out.save(dst)
print(dst, 'bbox', bbox, f'cover {cover:.2f}', f'opaque {sum(alpha.point(lambda v: 1 if v > 128 else 0).getdata()) / (w * h):.2f}')
