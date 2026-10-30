#!/usr/bin/env python3
"""捏臉底版：從 Ninja Adventure 角色複製精靈圖，分析正面圖各區域用色，輸出 src/engine/bodies.js。

用法：python3 -I tools/pie-plaza/build_bodies.py <ninja解壓目錄>
每個底版記錄 hair／skin／top／bottom 四組顏色；遊戲裡依玩家選擇對這些顏色換色。
"""
import json
import shutil
import sys
from collections import Counter
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2] / "site/games/community/pie-plaza"
BASES = [("Boy", "紅髮少年"), ("Villager", "光頭阿伯"), ("Villager2", "捲髮青年"), ("Villager3", "短髮青年"), ("Villager4", "金髮少年"),
         ("Woman", "金髮姑娘"), ("Princess", "長髮少女"), ("Cavegirl", "綠髮少女"), ("Cavegirl2", "紫髮少女"),
         ("Monk", "鬍子大叔"), ("Inspector", "偵探"), ("SorcererOrange", "橘髮法師"), ("OldWoman", "奶奶")]
OUTLINE_MAX = 45           # 接近黑色的是描邊，不換色


def lum(c): return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]


def is_skin(c):
    r, g, b = c[:3]
    return r > 150 and g > 90 and b < 150 and r > g > b and r - b > 60


def colors(fr, y0, y1):
    c = Counter()
    for y in range(y0, y1):
        for x in range(16):
            p = fr.getpixel((x, y))
            if p[3] and lum(p) >= OUTLINE_MAX: c[p[:3]] += 1
    return c


def analyse(im):
    """背面圖頭部（第 1 欄）幾乎都是頭髮或帽子；正面臉部剩下的暖色是皮膚；正面下半身是衣服。"""
    front, back = im.crop((0, 0, 16, 16)), im.crop((16, 0, 32, 16))
    roles = {"hair": [], "skin": [], "top": [], "bottom": []}
    face = Counter()
    for y in range(6, 11):
        for x in range(5, 11):
            p = front.getpixel((x, y))
            if p[3] and lum(p) >= OUTLINE_MAX: face[p[:3]] += 1
    warm = {c: n for c, n in face.items() if c[0] > 120 and 0.45 * c[0] < c[1] < 0.78 * c[0] and c[2] < c[1] and lum(c) > 95}
    top = max(warm.values(), default=0)
    roles["skin"] = [c for c, n in warm.items() if n >= max(2, top * 0.25)]
    for c, n in colors(back, 0, 9).items():
        if n >= 3 and c not in roles["skin"]: roles["hair"].append(c)
    ys = {}
    for y in range(9, 16):
        for x in range(16):
            p = front.getpixel((x, y))
            if p[3] and lum(p) >= OUTLINE_MAX and p[:3] not in roles["skin"] and p[:3] not in roles["hair"]:
                ys.setdefault(p[:3], []).append(y)
    for c, v in ys.items():
        (roles["bottom"] if sum(v) / len(v) >= 13.5 else roles["top"]).append(c)
    return roles


# 自動判斷不準的地方手動修正：{底版: {顏色: 角色}}
OVERRIDES = {
    "boy": {(150, 83, 64): "hair"},
    "villager": {(209, 75, 52): None},
    "villager2": {(209, 75, 52): "skin", (143, 62, 86): "skin"},
}


def fix(key, roles):
    for c, role in OVERRIDES.get(key, {}).items():
        for k in roles: roles[k] = [x for x in roles[k] if tuple(x) != c]
        if role: roles[role].append(c)
    return roles


def main(nj: Path) -> None:
    out, dst = [], ROOT / "assets/ninja/body"
    dst.mkdir(parents=True, exist_ok=True)
    for name, label in BASES:
        src = nj / "Ninja Adventure - Asset Pack/Actor/Character" / name
        key = name.lower()
        shutil.copyfile(src / "SpriteSheet.png", dst / f"{key}.png")
        shutil.copyfile(src / "Faceset.png", dst / f"{key}_face.png")
        roles = fix(key, analyse(Image.open(src / "SpriteSheet.png").convert("RGBA")))
        out.append({"id": key, "name": label, **{k: [list(c) for c in v] for k, v in roles.items()}})
    lines = ["// 由 tools/pie-plaza/build_bodies.py 產生，請勿手改。", "// 每個底版各區域的原始顏色（換色用）。",
             f"export const BODIES = {json.dumps(out, ensure_ascii=False)};"]
    (ROOT / "src/engine/bodies.js").write_text("\n".join(lines) + "\n", encoding="utf-8")
    for b in out: print(b["id"], {k: len(b[k]) for k in ("hair", "skin", "top", "bottom")})


if __name__ == "__main__":
    main(Path(sys.argv[1]))
