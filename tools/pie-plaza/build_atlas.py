#!/usr/bin/env python3
"""依大略格子範圍自動裁出物件實際邊界，輸出 src/engine/atlas.js。

用法：python3 -I tools/pie-plaza/build_atlas.py
每項是 名稱: (圖檔, x, y, w, h)；範圍可以抓大一點，腳本會裁掉透明邊。
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2] / "site/games/community/pie-plaza"
SPEC = {
    # --- Sprout Lands 擺設 ---
    "treeSmall": ("sprout/biom.png", 0, 0, 16, 32), "treeRound": ("sprout/biom.png", 16, 0, 32, 32),
    "treeApple": ("sprout/biom.png", 48, 0, 32, 32),
    "rockBig": ("sprout/biom.png", 128, 16, 16, 16), "rockSmall": ("sprout/biom.png", 112, 16, 16, 16),
    "rockFlat": ("sprout/biom.png", 80, 64, 16, 16), "pebble": ("sprout/biom.png", 96, 64, 16, 16),
    "log": ("sprout/biom.png", 80, 32, 16, 16), "stump": ("sprout/biom.png", 64, 32, 16, 16), "stumpSmall": ("sprout/biom.png", 48, 32, 16, 16),
    "sunflower": ("sprout/biom.png", 128, 32, 16, 32),
    "bushBerry": ("sprout/biom.png", 0, 48, 16, 16), "bush": ("sprout/biom.png", 16, 48, 16, 16),
    "sprout1": ("sprout/biom.png", 80, 16, 16, 16), "sprout2": ("sprout/biom.png", 96, 16, 16, 16),
    "mushA": ("sprout/biom.png", 80, 0, 16, 16), "mushB": ("sprout/biom.png", 96, 0, 16, 16),
    "mushC": ("sprout/biom.png", 112, 0, 16, 16), "mushD": ("sprout/biom.png", 128, 0, 16, 16),
    "flowerY": ("sprout/biom.png", 96, 32, 16, 16), "flowerY2": ("sprout/biom.png", 112, 32, 16, 16),
    "flowerP": ("sprout/biom.png", 96, 48, 16, 16), "flowerP2": ("sprout/biom.png", 112, 48, 16, 16),
    "flowerB": ("sprout/biom.png", 80, 48, 16, 16), "lily": ("sprout/biom.png", 112, 64, 16, 16),
    "chest": ("sprout/chest.png", 16, 16, 16, 16), "chickenHouse": ("sprout/chicken_house.png", 0, 0, 48, 48),
    "bridgeH": ("sprout/bridge.png", 32, 0, 48, 32),
    # 作物：[種子袋, 階段1..4, 收成]
    "wheat0": ("sprout/plants.png", 16, 0, 16, 16), "wheat1": ("sprout/plants.png", 32, 0, 16, 16),
    "wheat2": ("sprout/plants.png", 48, 0, 16, 16), "wheat3": ("sprout/plants.png", 64, 0, 16, 16),
    "wheatItem": ("sprout/plants.png", 80, 0, 16, 16), "wheatSeed": ("sprout/plants.png", 0, 0, 16, 16),
    "beet0": ("sprout/plants.png", 16, 16, 16, 16), "beet1": ("sprout/plants.png", 32, 16, 16, 16),
    "beet2": ("sprout/plants.png", 48, 16, 16, 16), "beet3": ("sprout/plants.png", 64, 16, 16, 16),
    "beetItem": ("sprout/plants.png", 80, 16, 16, 16), "beetSeed": ("sprout/plants.png", 0, 16, 16, 16),
    # Sprout 家具
    "bedGreen": ("sprout/furniture.png", 0, 24, 16, 26), "bedBlue": ("sprout/furniture.png", 16, 24, 16, 26),
    "bedPink": ("sprout/furniture.png", 32, 24, 16, 26),
    "dresser": ("sprout/furniture.png", 48, 32, 16, 32), "chairL": ("sprout/furniture.png", 64, 32, 16, 16),
    "chairR": ("sprout/furniture.png", 80, 32, 16, 16), "stool": ("sprout/furniture.png", 96, 32, 16, 16),
    "stool2": ("sprout/furniture.png", 112, 32, 16, 16), "tableSmall": ("sprout/furniture.png", 64, 48, 16, 16),
    "clock": ("sprout/furniture.png", 80, 48, 16, 16), "clockRound": ("sprout/furniture.png", 96, 48, 16, 16),
    "plantPot": ("sprout/furniture.png", 48, 0, 16, 16), "plantPot2": ("sprout/furniture.png", 64, 0, 16, 16),
    "flowerPot": ("sprout/furniture.png", 80, 0, 16, 16),
    "lampG": ("sprout/furniture.png", 48, 16, 16, 16), "lampB": ("sprout/furniture.png", 64, 16, 16, 16),
    "lampP": ("sprout/furniture.png", 80, 16, 16, 16),
    "paintFlower": ("sprout/furniture.png", 0, 0, 16, 16), "paintField": ("sprout/furniture.png", 16, 0, 16, 16),
    "paintNight": ("sprout/furniture.png", 32, 0, 16, 16),
    "rugGS": ("sprout/furniture.png", 0, 80, 16, 16), "rugPS": ("sprout/furniture.png", 16, 80, 16, 16),
    "rugBS": ("sprout/furniture.png", 32, 80, 16, 16), "rugGL": ("sprout/furniture.png", 48, 80, 32, 16),
    "rugPL": ("sprout/furniture.png", 80, 80, 32, 16), "rugBL": ("sprout/furniture.png", 112, 80, 32, 16),
    # --- Ninja Adventure 建築（TilesetHouse） ---
    "houseOrange": ("ninja/house.png", 0, 0, 64, 48), "houseBeige": ("ninja/house.png", 64, 0, 64, 48),
    "houseOrange2": ("ninja/house.png", 128, 0, 64, 48), "shopRed": ("ninja/house.png", 192, 0, 64, 48),
    "shopBurger": ("ninja/house.png", 256, 0, 48, 48), "shopDark": ("ninja/house.png", 304, 0, 64, 48),
    "shopBakery": ("ninja/house.png", 368, 0, 48, 48), "houseAngle": ("ninja/house.png", 416, 0, 48, 48),
    "houseChimney": ("ninja/house.png", 464, 0, 64, 64),
    "houseThatch": ("ninja/house.png", 400, 112, 64, 112), "houseWood": ("ninja/house.png", 400, 224, 64, 80),
    "houseSmall": ("ninja/house.png", 304, 304, 48, 48),
    "awningA": ("ninja/house.png", 256, 256, 48, 32), "awningB": ("ninja/house.png", 304, 256, 48, 32),
    "banner1": ("ninja/house.png", 352, 320, 16, 32), "banner2": ("ninja/house.png", 368, 320, 16, 32),
    "banner3": ("ninja/house.png", 384, 320, 16, 32), "banner4": ("ninja/house.png", 400, 320, 16, 32),
    "banner5": ("ninja/house.png", 416, 320, 16, 32), "banner6": ("ninja/house.png", 432, 320, 16, 32),
    "torii": ("ninja/house.png", 0, 80, 48, 32),
    "potsA": ("ninja/house.png", 256, 192, 48, 32), "barrels": ("ninja/house.png", 256, 240, 48, 16),
    "fruitCrates": ("ninja/house.png", 304, 224, 48, 32),
    # --- Ninja 自然 ---
    "treeBig": ("ninja/nature.png", 48, 288, 48, 48), "treeBigPink": ("ninja/nature.png", 0, 288, 48, 48),
    "treeBigOrange": ("ninja/nature.png", 144, 288, 48, 48),
    "treeClump": ("ninja/nature.png", 256, 32, 64, 48), "treeClump2": ("ninja/nature.png", 64, 32, 64, 48),
    "pineClump": ("ninja/nature.png", 0, 32, 64, 48), "pine": ("ninja/nature.png", 32, 0, 32, 32),
    "treeN": ("ninja/nature.png", 256, 0, 32, 32), "treeN2": ("ninja/nature.png", 288, 0, 32, 32),
    "stumpBig": ("ninja/nature.png", 0, 128, 32, 32), "grayRock": ("ninja/nature.png", 256, 128, 32, 32),
    "grayRockS": ("ninja/nature.png", 288, 144, 16, 16), "brownRockS": ("ninja/nature.png", 240, 144, 16, 16),
    "weedA": ("ninja/nature.png", 48, 160, 16, 16), "weedB": ("ninja/nature.png", 64, 160, 16, 16),
    "weedC": ("ninja/nature.png", 80, 160, 16, 16), "weedD": ("ninja/nature.png", 112, 160, 16, 16),
    "weedE": ("ninja/nature.png", 144, 160, 16, 16), "fern": ("ninja/nature.png", 128, 176, 16, 16),
    "bushRound": ("ninja/nature.png", 0, 160, 16, 16), "bushRound2": ("ninja/nature.png", 16, 160, 16, 16),
    # --- Ninja 室內擺設（TilesetElement） ---
    "crate": ("ninja/element.png", 0, 0, 16, 16), "barrel": ("ninja/element.png", 16, 0, 16, 16),
    "jarRed": ("ninja/element.png", 48, 0, 16, 16), "pot": ("ninja/element.png", 64, 0, 16, 16),
    "sack": ("ninja/element.png", 0, 16, 16, 16), "sack2": ("ninja/element.png", 16, 16, 16, 16),
    "basket": ("ninja/element.png", 32, 16, 16, 16), "chestN": ("ninja/element.png", 48, 16, 16, 16),
    "cauldron": ("ninja/element.png", 64, 16, 16, 16), "signSmall": ("ninja/element.png", 0, 32, 16, 16),
    "counterLong": ("ninja/element.png", 176, 16, 48, 16), "signPost": ("ninja/element.png", 96, 48, 16, 32),
    "sofa": ("ninja/element.png", 64, 56, 32, 24),
    "plantN": ("ninja/element.png", 0, 112, 16, 32), "drawerN": ("ninja/element.png", 16, 112, 16, 32),
    "cabinetN": ("ninja/element.png", 32, 112, 16, 32), "bookcase": ("ninja/element.png", 48, 112, 16, 32),
    "shelfN": ("ninja/element.png", 64, 112, 16, 32), "tableWhite": ("ninja/element.png", 80, 112, 16, 16),
    "dresserBig": ("ninja/element.png", 96, 112, 32, 32), "bookcaseBig": ("ninja/element.png", 128, 112, 32, 32),
    "shelfBig": ("ninja/element.png", 160, 112, 32, 32),
    "chairN": ("ninja/element.png", 0, 144, 16, 16), "drawerS": ("ninja/element.png", 16, 144, 16, 16),
    "potN": ("ninja/element.png", 32, 144, 16, 16), "tableN": ("ninja/element.png", 48, 144, 16, 16),
    "stoolN": ("ninja/element.png", 64, 144, 16, 16), "bread": ("ninja/element.png", 80, 144, 16, 16),
    "redTable": ("ninja/element.png", 112, 144, 16, 16), "redTableLong": ("ninja/element.png", 128, 144, 48, 16),
    "tableLong": ("ninja/element.png", 32, 160, 48, 16), "railing": ("ninja/element.png", 32, 176, 64, 16),
    "hay": ("ninja/element.png", 192, 64, 16, 32), "strawMat": ("ninja/element.png", 208, 64, 48, 48),
    "vase": ("ninja/element.png", 0, 160, 16, 16), "rugN": ("ninja/element.png", 96, 160, 16, 16),
}
# grok 補畫的素材（tools/pie-plaza/process_art.py 輸出到 assets/gen/）
for crop in ("carrot", "tomato", "pumpkin", "strawberry"):
    for i in range(4):
        SPEC[f"{crop}{i}"] = (f"gen/{crop}_{i}.png", 0, 0, 16, 16)
    SPEC[f"{crop}Item"] = (f"gen/{crop}_item.png", 0, 0, 16, 16)
    SPEC[f"{crop}Seed"] = (f"gen/{crop}_seed.png", 0, 0, 16, 16)
for fish in ("carp", "catfish", "bass", "trout", "sardine", "tuna", "puffer", "golden"):
    SPEC[f"fish{fish[0].upper()}{fish[1:]}"] = (f"gen/fish_{fish}.png", 0, 0, 16, 16)
# 原創地標：菲比啾比女神噴水池、瑞吉海獅秀（grok 依 pie-phoebe 原畫重繪成像素風）
for i in range(3):
    SPEC[f"fountain{i}"] = (f"gen/fountain_{i}.png", 0, 0, 64, 64)
for pose in ("idle", "bark", "ball", "jump"):
    SPEC[f"reggie{pose[0].upper()}{pose[1:]}"] = (f"gen/reggie_{pose}.png", 0, 0, 32, 32)
SPEC["showStage"] = ("gen/show_stage.png", 0, 0, 96, 64)
SPEC["showBench"] = ("gen/show_bench.png", 0, 0, 32, 16)
for n in (27, 6, 18, 22, 23, 20, 13, 29, 17, 28):
    SPEC[f"emote{n}"] = (f"ninja/emote/e{n}.png", 0, 0, 14, 13)
SPEC.update({
    "junkBoot": ("gen/junk_boot.png", 0, 0, 16, 16), "rodIcon": ("gen/rod.png", 0, 0, 16, 16),
    "campfire": ("gen/campfire.png", 0, 0, 16, 16), "lampPost": ("gen/lamp_post.png", 0, 0, 16, 32),
    "bulletinBoard": ("gen/bulletin_board.png", 0, 0, 32, 32), "lanternString": ("gen/lantern_string.png", 0, 0, 32, 16),
    # 派對競技場（antigravity 依 art/arena/BRIEF.md 生成）
    "arenaPie": ("gen/arena_pie.png", 0, 0, 16, 16), "arenaPieGold": ("gen/arena_pie_gold.png", 0, 0, 16, 16),
    "arenaSplat": ("gen/arena_splat.png", 0, 0, 16, 16), "arenaCrown": ("gen/arena_crown.png", 0, 0, 16, 16),
    "arenaPodium": ("gen/arena_podium.png", 0, 0, 48, 32), "arenaDesk": ("gen/arena_desk.png", 0, 0, 48, 32),
})


def main() -> None:
    out = {}
    for name, (sheet, x, y, w, h) in SPEC.items():
        im = Image.open(ROOT / "assets" / sheet).convert("RGBA")
        box = im.crop((x, y, x + w, y + h)).getbbox()
        if not box:
            raise SystemExit(f"{name}: 範圍內是空的")
        out[name] = [sheet, x + box[0], y + box[1], box[2] - box[0], box[3] - box[1]]
    # 動畫的每一格要用同一個範圍（取聯集），輪播時才不會抖
    for prefix in ("fountain", "reggie"):
        names = [n for n in out if n.startswith(prefix)]
        x0 = min(out[n][1] - SPEC[n][1] for n in names); y0 = min(out[n][2] - SPEC[n][2] for n in names)
        x1 = max(out[n][1] - SPEC[n][1] + out[n][3] for n in names); y1 = max(out[n][2] - SPEC[n][2] + out[n][4] for n in names)
        for n in names:
            out[n] = [out[n][0], SPEC[n][1] + x0, SPEC[n][2] + y0, x1 - x0, y1 - y0]
    lines = ["// 由 tools/pie-plaza/build_atlas.py 產生，請勿手改。", "// 名稱: [圖檔, x, y, w, h]", "export const ATLAS = {"]
    for k, v in out.items():
        lines.append(f"  {k}: {json.dumps(v)},")
    lines.append("};")
    # 門口：建築底部往上數第 3 列，最長一段很暗的像素就是門；記錄門中心相對圖片中心的 x 位移與門寬
    doors = {}
    for name, (sheet, x, y, w, h) in out.items():
        if not name.startswith(("house", "shop")):
            continue
        im = Image.open(ROOT / "assets" / sheet).convert("RGBA").crop((x, y, x + w, y + h))
        best = (0, 0)
        for row in (h - 3, h - 5, h - 7):
            run = start = 0
            for cx in range(w + 1):
                p = im.getpixel((cx, row)) if cx < w else (255, 255, 255, 255)
                dark = p[3] > 0 and p[0] + p[1] + p[2] < 110
                if dark:
                    if run == 0: start = cx
                    run += 1
                else:
                    if run > best[0]: best = (run, start)
                    run = 0
            if best[0] >= 6: break
        if best[0] >= 6:
            doors[name] = [best[1] + best[0] / 2 - w / 2, best[0]]
    lines.append(f"export const DOORS = {json.dumps(doors)};")
    sheets = sorted({v[0] for v in out.values()})
    lines.append(f"export const SHEETS = {json.dumps(sheets)};")
    (ROOT / "src/engine/atlas.js").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(out)} 個物件，{len(sheets)} 張圖")


if __name__ == "__main__":
    main()
