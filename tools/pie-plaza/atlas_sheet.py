#!/usr/bin/env python3
"""把 atlas.js 每個物件畫成一張帶名稱的目錄圖，檢查裁切是否正確。用法：python3 -I atlas_sheet.py 輸出.png [關鍵字]"""
import json, re, sys
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[2] / "site/games/community/pie-plaza"
src = (ROOT / "src/engine/atlas.js").read_text(encoding="utf-8")
items = [(m.group(1), json.loads(m.group(2))) for m in re.finditer(r"^  (\w+): (\[.*\]),$", src, re.M)]
if len(sys.argv) > 2: items = [i for i in items if sys.argv[2] in i[1][0] or sys.argv[2] in i[0]]
S, cw, ch, cols = 3, 140, 150, 9
W = Image.new("RGBA", (cols * cw, ((len(items) + cols - 1) // cols) * ch), (70, 90, 70, 255)); d = ImageDraw.Draw(W)
for i, (n, (sheet, x, y, w, h)) in enumerate(items):
    im = Image.open(ROOT / "assets" / sheet).convert("RGBA").crop((x, y, x + w, y + h))
    k = max(1, min(S, 128 // max(w, h)))
    im = im.resize((w * k, h * k), Image.NEAREST)
    cx, cy = (i % cols) * cw, (i // cols) * ch
    W.alpha_composite(im, (cx + 4, cy + 4)); d.text((cx + 2, cy + ch - 14), n, fill=(255, 255, 0, 255))
W.save(sys.argv[1])
