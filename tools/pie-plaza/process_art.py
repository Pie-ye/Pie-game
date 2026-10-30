#!/usr/bin/env python3
"""把 grok 產生的放大像素圖（每個像素是 32×32 方塊、洋紅底）縮回原生大小並去背。

用法：python3 -I tools/pie-plaza/process_art.py
讀 tools/pie-plaza/art/{fish,cropsA,cropsB}/*.png，輸出 site/games/community/pie-plaza/assets/gen/<同名>.png。
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tools/pie-plaza/art"
OUT = ROOT / "site/games/community/pie-plaza/assets/gen"
BLOCK = 32


def magenta(p):
    r, g, b = p[:3]
    return r > 180 and b > 180 and g < 110


def process(src: Path) -> Path:
    im = Image.open(src).convert("RGB")
    if max(im.size) <= 128:                     # 已經是原生大小：只去背
        out = Image.new("RGBA", im.size)
        for y in range(im.size[1]):
            for x in range(im.size[0]):
                p = im.getpixel((x, y))
                out.putpixel((x, y), (0, 0, 0, 0) if magenta(p) else (*p, 255))
        out.save(OUT / src.name)
        return OUT / src.name
    if im.size[0] % BLOCK or im.size[1] % BLOCK or im.size[0] < BLOCK * 8:
        print(f"略過 {src.name}：尺寸 {im.size} 不是 {BLOCK} 的倍數")
        return None
    w, h = im.size[0] // BLOCK, im.size[1] // BLOCK
    out = Image.new("RGBA", (w, h))
    for y in range(h):
        for x in range(w):
            # 取方塊中央 3×3 的眾數，避開邊緣壓縮雜訊
            votes = {}
            for dy in (-4, 0, 4):
                for dx in (-4, 0, 4):
                    p = im.getpixel((x * BLOCK + BLOCK // 2 + dx, y * BLOCK + BLOCK // 2 + dy))
                    votes[p] = votes.get(p, 0) + 1
            p = max(votes, key=votes.get)
            out.putpixel((x, y), (0, 0, 0, 0) if magenta(p) else (*p, 255))
    dst = OUT / src.name
    out.save(dst)
    return dst


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for lane in ("fish", "cropsA", "cropsB", "show"):
        for f in sorted((SRC / lane).glob("*.png")):
            n += 1 if process(f) else 0
    print(f"{n} 張 → {OUT}")


if __name__ == "__main__":
    main()
