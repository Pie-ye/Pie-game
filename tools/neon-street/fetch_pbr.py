"""從 Poly Haven（CC0）下載 PBR 材質，轉成遊戲用的「細節層」貼圖。

用法：python3 tools/neon-street/fetch_pbr.py [--force]

輸出（進版控，遊戲直接載入）：
  site/games/community/neon-arcade-street/assets/pbr/<名稱>_c.jpg   反照率倍率（每個色版除以自己的平均，所以不改變手繪底色的色相與亮度，
                                                                     只帶來顆粒、髒污、鏽斑；存成 0.5 倍，著色器再乘 2；以 sRGB 儲存）
  site/games/community/neon-arcade-street/assets/pbr/<名稱>_n.jpg   R,G＝法線 XY（OpenGL 慣例）、B＝相對粗糙度（除以平均，存成 0.5 倍）
  site/games/community/neon-arcade-street/assets/pbr/pbr.json       每組材質的實際尺寸（公尺），著色器依此在世界座標平鋪

原始下載放 tools/neon-street/pbr_src/（不進版控）。授權與作者見 assets/pbr/CREDITS.md。
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / 'pbr_src'
OUT = HERE.parent.parent / 'site' / 'games' / 'community' / 'neon-arcade-street' / 'assets' / 'pbr'

# 名稱: (Poly Haven id, 輸出邊長 px)
SETS = {
    'asphalt': ('asphalt_02', 1024),            # 柏油路面（有裂縫、顆粒）
    'pavement': ('concrete_pavement', 1024),    # 人行道方磚
    'plaza': ('concrete_tile_facade', 1024),    # 廣場深色方磚
    'wall_a': ('concrete_wall_004', 512),      # 分縫混凝土牆
    'wall_b': ('concrete_slab_wall', 512),     # 混凝土板牆
    'wall_d': ('dark_brick_wall', 1024),        # 深色磚牆
    'wall_e': ('factory_wall', 512),           # 瓦楞工廠牆
    'wall_g': ('rough_concrete', 512),         # 粗混凝土（屋頂、基座）
    'metal': ('metal_plate_02', 512),           # 刮痕金屬板
    'paint': ('blue_metal_plate', 512),         # 烤漆金屬
    'bark': ('bark_brown_02', 512),             # 樹皮
    'corr': ('corrugated_iron_03', 512),        # 瓦楞鐵（遮雨棚）
}


def get(url, dest):
    if dest.exists() and dest.stat().st_size > 0 and '--force' not in sys.argv:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'pie-game-asset-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        dest.write_bytes(r.read())


def api(path):
    req = urllib.request.Request('https://api.polyhaven.com' + path, headers={'User-Agent': 'pie-game-asset-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def to_lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def process(name, pid, size, info):
    d = SRC / pid
    fl = api(f'/files/{pid}')
    for key, tag in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('Rough', 'rough')):
        get(fl[key]['1k']['jpg']['url'], d / f'{tag}.jpg')
    diff = Image.open(d / 'diff.jpg').convert('RGB')
    nor = Image.open(d / 'nor.jpg').convert('RGB')
    rough = Image.open(d / 'rough.jpg').convert('L')
    rs = lambda im: im.resize((size, size), Image.LANCZOS) if im.size != (size, size) else im
    diff, nor, rough = rs(diff), rs(nor), rs(rough)
    # 反照率倍率：線性空間下每個色版除以自己的平均
    lin = to_lin(np.asarray(diff, dtype=np.float32) / 255)
    mult = lin / np.maximum(lin.mean(axis=(0, 1), keepdims=True), 1e-4)
    mult = np.clip(mult * 0.5, 0, 1)                    # 存成 0.5 倍，最大可表示 2.0 倍
    Image.fromarray((to_srgb(mult) * 255 + 0.5).astype(np.uint8)).save(OUT / f'{name}_c.jpg', quality=88, subsampling=0)
    # 法線 XY + 相對粗糙度
    n = np.asarray(nor, dtype=np.float32) / 255
    r = np.asarray(rough, dtype=np.float32) / 255
    rr = np.clip(r / max(r.mean(), 1e-4) * 0.5, 0, 1)
    packed = np.stack([n[..., 0], n[..., 1], rr], axis=-1)
    Image.fromarray((packed * 255 + 0.5).astype(np.uint8)).save(OUT / f'{name}_n.jpg', quality=86, subsampling=0)
    dims = info['dimensions']
    tile = round(float(dims[0]) / 1000, 3)
    return dict(tile=tile, source=pid, mean_rough=round(float(r.mean()), 3), authors=list(info.get('authors', {}).keys()))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta, infos = {}, {}
    for name, (pid, size) in SETS.items():
        infos.setdefault(pid, api(f'/info/{pid}'))
        meta[name] = process(name, pid, size, infos[pid])
        print(f'{name:9s} <- {pid:22s} tile={meta[name]["tile"]} m  rough={meta[name]["mean_rough"]}')
    (OUT / 'pbr.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    lines = ['# 材質來源（Poly Haven，CC0 公眾領域）', '',
             '`assets/pbr/` 內的細節層由 [Poly Haven](https://polyhaven.com) 的 CC0 材質轉出（`tools/neon-street/fetch_pbr.py`）。',
             'CC0 不要求署名，這裡仍列出作者以示感謝。', '']
    for pid in sorted(infos):
        a = ', '.join(infos[pid].get('authors', {}).keys())
        lines.append(f'- [{pid}](https://polyhaven.com/a/{pid})：{a}')
    # 只改寫「Poly Haven 材質」這一節；其他節（道具模型由 fetch_props.py 寫、ambientCG 立面手寫）原樣保留
    cf = OUT / 'CREDITS.md'
    rest = ''
    if cf.exists():
        old = cf.read_text()
        i = old.find('\n## ')
        rest = old[i:] if i >= 0 else ''
    cf.write_text('\n'.join(lines) + '\n' + rest)


if __name__ == '__main__':
    main()
