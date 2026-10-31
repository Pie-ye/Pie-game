#!/usr/bin/env python3
"""把派對競技場的派（assets/gen/arena_pie.png）換色成五種口味的派餅圖示：奶油區（最亮的部分）換成餡料色，保留明暗。

用法：python3 -I tools/pie-plaza/tint_pies.py
"""
import colorsys
from pathlib import Path
from PIL import Image

GEN = Path(__file__).resolve().parents[2] / "site/games/community/pie-plaza/assets/gen"
TINTS = {"strawberry": (0.97, 0.62), "pumpkin": (0.07, 0.8), "tomato": (0.0, 0.7), "carrot": (0.1, 0.9), "beet": (0.87, 0.55)}


def main() -> None:
    src = Image.open(GEN / "arena_pie.png").convert("RGBA")
    for name, (h, sat) in TINTS.items():
        im = src.copy()
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if not a:
                    continue
                _hh, l, _s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
                if l > 0.78:
                    nr, ng, nb = colorsys.hls_to_rgb(h, 0.42 + (l - 0.78) * 1.2, sat)
                    px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
        im.save(GEN / f"pie_{name}.png")
    print("ok", len(TINTS))


if __name__ == "__main__":
    main()
