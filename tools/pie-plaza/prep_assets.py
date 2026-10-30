#!/usr/bin/env python3 -I
"""把下載解壓後的素材挑出實際用到的檔案，複製到 pie-plaza/assets。

用法：python3 -I tools/pie-plaza/prep_assets.py <sprout解壓目錄> <ninja解壓目錄> <zpix.woff2>
素材包本身不進版控（Sprout Lands 授權禁止轉散布素材包），只放遊戲實際用到的檔案。
"""
import shutil
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "site/games/community/pie-plaza/assets"
# 商店街 NPC：店主與路人（Ninja Adventure 角色與對話頭像）
NPCS = ["OldMan2", "Hunter", "Woman", "Villager4", "Cavegirl2", "OldMan", "Noble", "Child", "OldWoman", "Villager3"]


def main(sprout: Path, ninja: Path, font: Path) -> None:
    sp = sprout / "Sprout Lands - Sprites - Basic pack"
    nj = ninja / "Ninja Adventure - Asset Pack"
    pairs = {
        "sprout/grass.png": sp / "Tilesets/Grass.png",
        "sprout/water.png": sp / "Tilesets/Water.png",
        "sprout/dirt.png": sp / "Tilesets/Tilled_Dirt_v2.png",
        "sprout/fences.png": sp / "Tilesets/Fences.png",
        "sprout/house.png": sp / "Tilesets/Wooden House.png",
        "sprout/biom.png": sp / "Objects/Basic_Grass_Biom_things.png",
        "sprout/furniture.png": sp / "Objects/Basic_Furniture.png",
        "sprout/chest.png": sp / "Objects/Chest.png",
        "sprout/chicken_house.png": sp / "Objects/Free_Chicken_House.png",
        "ninja/dialog.png": nj / "Ui/Dialog/DialogueBoxSimple.png",
        "audio/village.ogg": nj / "Audio/Musics/4 - Village.ogg",
        "audio/bird.wav": nj / "Audio/Sounds/Creature/Bird.wav",
        "audio/send.wav": nj / "Audio/Sounds/Menu/Move1.wav",
        "audio/recv.wav": nj / "Audio/Sounds/Menu/Move2.wav",
        "audio/join.wav": nj / "Audio/Sounds/Bonus/Coin.wav",
        "fonts/zpix.woff2": font,
        # 農場：作物、耕地、橋
        "sprout/plants.png": sp / "Objects/Basic_Plants.png",
        "sprout/tilled.png": sp / "Tilesets/Tilled_Dirt.png",
        "sprout/bridge.png": sp / "Objects/Wood_Bridge.png",
        # 商店街、小屋、室內（Ninja Adventure，CC0）
        "ninja/house.png": nj / "Backgrounds/Tilesets/TilesetHouse.png",
        "ninja/element.png": nj / "Backgrounds/Tilesets/TilesetElement.png",
        "ninja/nature.png": nj / "Backgrounds/Tilesets/TilesetNature.png",
        "ninja/interior_floor.png": nj / "Backgrounds/Tilesets/Interior/TilesetInteriorFloor.png",
    }
    for tool in ["Axe", "Pickaxe", "Sickle", "Hoe", "WateringCan", "Hammer"]:
        pairs[f"ninja/tools/{tool.lower()}.png"] = nj / f"Items/Tool/{tool}.png"
    for npc in NPCS:
        pairs[f"ninja/npc/{npc.lower()}.png"] = nj / f"Actor/Character/{npc}/SpriteSheet.png"
        pairs[f"ninja/npc/{npc.lower()}_face.png"] = nj / f"Actor/Character/{npc}/Faceset.png"
    for dst, src in pairs.items():
        out = ROOT / dst
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, out)
        print(f"{dst:28s} {out.stat().st_size:>9,d} bytes")

    # 風聲環境音：原檔 3.7 MB，取中段 12 秒、降為 11 kHz 單聲道，頭尾交叉淡化成可循環
    with wave.open(str(nj / "Audio/Sounds/Ambient/Wind.wav")) as w:
        ch, sw, fr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    assert sw == 2, "預期 16-bit"
    import array
    a = array.array("h"); a.frombytes(raw)
    mono = [sum(a[i:i + ch]) // ch for i in range(0, len(a) - ch + 1, ch)]
    step = max(1, fr // 11025)
    ds = [sum(mono[i:i + step]) // step for i in range(0, len(mono) - step + 1, step)]
    rate = fr // step
    seg = ds[len(ds) // 4: len(ds) // 4 + rate * 12]
    fade = min(rate, len(seg) // 4)
    for i in range(fade):                       # 尾端漸弱、頭端漸強後相加，接縫不會爆音
        t = i / fade
        seg[i] = int(seg[i] * t + seg[len(seg) - fade + i] * (1 - t))
    seg = seg[:len(seg) - fade]
    out = ROOT / "audio/wind.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(array.array("h", [max(-32768, min(32767, v)) for v in seg]).tobytes())
    print(f"audio/wind.wav               {out.stat().st_size:>9,d} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
