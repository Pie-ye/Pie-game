#!/usr/bin/env python3
"""把 Colab 生成的無縫貼圖校色後放進遊戲：python3 process_tex.py <來源.png> <名稱> <目標色 hex> [強度 0..1] [尺寸]
校色：把整張圖的平均色往美術聖經的色票移動（保留細節與明暗），輸出 assets/tex/<名稱>.jpg。"""
import sys
from pathlib import Path
from PIL import Image
import colorsys

src, name, hexc = sys.argv[1:4]
k = float(sys.argv[4]) if len(sys.argv) > 4 else 0.7
size = int(sys.argv[5]) if len(sys.argv) > 5 else 1024
im = Image.open(src).convert('RGB').resize((size, size), Image.LANCZOS)
px = im.load()
w, h = im.size
mean = [sum(px[x, y][c] for x in range(0, w, 4) for y in range(0, h, 4)) / ((w // 4) * (h // 4)) for c in range(3)]
tgt = [int(hexc.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)]
gain = [(1 - k) + k * (t / max(m, 1)) for t, m in zip(tgt, mean)]
out = Image.new('RGB', im.size)
op = out.load()
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        op[x, y] = tuple(max(0, min(255, int(v * gg))) for v, gg in zip((r, g, b), gain))
dst = Path(__file__).resolve().parents[2] / 'site/games/community/pie-island/assets/tex' / f'{name}.jpg'
dst.parent.mkdir(parents=True, exist_ok=True)
out.save(dst, quality=85)
print(dst, [round(m) for m in mean], '->', tgt)
