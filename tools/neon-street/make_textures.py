#!/usr/bin/env python3
"""產生霓虹電玩街的所有貼圖（Pillow）。輸出到 tools/neon-street/tex/。

用法：python3 make_textures.py [--only 名稱前綴]
招牌文字、光暈位置來自 scene_gen（與 Blender 組裝用同一份排版）。
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

import scene_gen as S

HERE = Path(__file__).resolve().parent
OUT = HERE / 'tex'
OUT.mkdir(exist_ok=True)
ART = HERE / 'art'
FONT = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
FONT_LAT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def hx(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mul(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def mix(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))


def font(size, latin=False):
    return ImageFont.truetype(FONT_LAT if latin else FONT, size)


def save(img, name, q=88):
    p = OUT / name
    if name.endswith('.png'):
        img.save(p, optimize=True)
    else:
        img.convert('RGB').save(p, quality=q, optimize=True, subsampling=0 if ('sign' in name or '_m.' in name) else 2)
    print('  ', name, img.size, p.stat().st_size // 1024, 'KB')


def noise(size, sigma=14, seed=0):
    random.seed(seed)
    return Image.effect_noise(size, sigma)


def _tnoise(cells, w, h, sigma, seed, tile):
    """cells＝低解析度雜訊格數 (cw, ch)，放大成 w×h；tile=True 時可無縫平鋪。"""
    cw, ch = cells
    small = noise((cw, ch), sigma, seed)
    if not tile:
        return small.resize((w, h), Image.BICUBIC)
    big = Image.new('L', (cw * 3, ch * 3))
    for i in range(3):
        for j in range(3):
            big.paste(small, (i * cw, j * ch))
    big = big.resize((w * 3, h * 3), Image.BICUBIC)
    return big.crop((w, h, w * 2, h * 2))


def grime(img, seed, strength=0.55, streak=True, tile=False):
    """髒污：垂直雨水流痕與斑駁污漬，乘在底圖上（只暗化，不加色）。tile=True 可無縫平鋪。"""
    w, h = img.size
    sm = _tnoise((max(4, w // 64), max(4, h // 4)), w, h, 40, seed, tile) if streak else Image.new('L', (w, h), 128)
    blotch = _tnoise((max(4, w // 48), max(4, h // 48)), w, h, 40, seed + 1, tile)
    m = ImageChops.multiply(sm, blotch).point(lambda v: int(255 - min(255, max(0, (v - 40) * 1.4)) * strength))
    return ImageChops.multiply(img, Image.merge('RGB', (m, m, m)))


_GRAD = None


def blob(base, cx, cy, r, color, alpha=1.0, power=1.8):
    """在 base（RGB）上以加法疊一個柔光圓。"""
    global _GRAD
    if _GRAD is None:
        # radial_gradient 在邊緣中點只到 181（角落才是 255），先重新縮放讓圓邊歸零
        _GRAD = Image.radial_gradient('L').point(lambda v: max(0, 255 - int(v * 255 / 181)))
    d = max(2, int(r * 2))
    patch = _GRAD.resize((d, d), Image.BILINEAR).point(lambda v: int(255 * (v / 255) ** power))
    rgb = ImageChops.multiply(Image.merge('RGB', (patch,) * 3), Image.new('RGB', (d, d), mul(color, alpha)))
    x0, y0 = int(cx - d / 2), int(cy - d / 2)
    box = (max(0, x0), max(0, y0), min(base.width, x0 + d), min(base.height, y0 + d))
    if box[2] <= box[0] or box[3] <= box[1]:
        return
    sub = rgb.crop((box[0] - x0, box[1] - y0, box[2] - x0, box[3] - y0))
    base.paste(ImageChops.add(base.crop(box), sub), box)


def glow_text(img, xy, text, f, color, anchor='mm', blur=6, stroke=0):
    layer = Image.new('RGB', img.size, (0, 0, 0))
    ImageDraw.Draw(layer).text(xy, text, font=f, fill=color, anchor=anchor, stroke_width=stroke, stroke_fill=color)
    halo = layer.filter(ImageFilter.GaussianBlur(blur))
    img.paste(ImageChops.add(img, ImageChops.add(halo, halo.point(lambda v: v // 2))))
    core = Image.new('RGB', img.size, (0, 0, 0))
    ImageDraw.Draw(core).text(xy, text, font=f, fill=mix(color, (255, 255, 255), 0.62), anchor=anchor,
                              stroke_width=max(0, stroke - 1), stroke_fill=mix(color, (255, 255, 255), 0.62))
    img.paste(ImageChops.lighter(img, core))


def has_cjk(t):
    return any(ord(c) > 0x2E80 for c in t)


def fit_font(draw_w, draw_h, text, latin=None, max_size=400):
    latin = (not has_cjk(text)) if latin is None else latin
    size = max_size
    while size > 8:
        f = font(size, latin)
        bb = f.getbbox(text)
        if bb[2] - bb[0] <= draw_w and bb[3] - bb[1] <= draw_h:
            return f
        size -= 4
    return font(8, latin)


def star(draw, cx, cy, r, fill, n=5):
    pts = [(cx + math.cos(-math.pi / 2 + math.pi * i / n) * (r if i % 2 == 0 else r * 0.42),
            cy + math.sin(-math.pi / 2 + math.pi * i / n) * (r if i % 2 == 0 else r * 0.42)) for i in range(2 * n)]
    draw.polygon(pts, fill=fill)


# ───────────────────────── 招牌 ─────────────────────────
def sign_cell(w, h, text, col_hex, vertical=False, stars=False):
    col = hx(col_hex)
    img = Image.new('RGB', (w, h), (8, 6, 14))
    d = ImageDraw.Draw(img)
    m = int(min(w, h) * 0.06)
    d.rounded_rectangle((m, m, w - m, h - m), radius=int(min(w, h) * 0.16), outline=col, width=max(3, int(min(w, h) * 0.03)))
    d.rounded_rectangle((m * 2.2, m * 2.2, w - m * 2.2, h - m * 2.2), radius=int(min(w, h) * 0.1),
                        outline=mul(col, 0.45), width=max(2, int(min(w, h) * 0.012)))
    # 底部微光
    bg = Image.new('RGB', (w, h), (0, 0, 0))
    blob(bg, w / 2, h / 2, max(w, h) * 0.7, mul(col, 0.18), 1.0, 1.4)
    img = ImageChops.add(img, bg)
    glow = Image.new('RGB', (w, h), (0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle((m, m, w - m, h - m), radius=int(min(w, h) * 0.16), outline=col, width=max(3, int(min(w, h) * 0.03)))
    img = ImageChops.add(img, glow.filter(ImageFilter.GaussianBlur(5)))
    if vertical:
        chars = list(text)
        cell_h = (h - 4 * m) / max(2, len(chars))
        size_box = min(w - 5 * m, cell_h * 0.9)
        for i, ch in enumerate(chars):
            f = fit_font(size_box, size_box, ch, latin=not has_cjk(ch), max_size=500)
            glow_text(img, (w / 2, 2 * m + cell_h * (i + 0.5)), ch, f, col, blur=7, stroke=2)
    else:
        pad = 0.16 if not stars else 0.28
        f = fit_font(w * (1 - 2 * pad), h * 0.56, text, max_size=300)
        glow_text(img, (w / 2, h / 2 + 2), text, f, col, blur=8, stroke=2)
        if stars:   # 大招牌兩端的裝飾：改成機械式的箭頭標記
            sd = ImageDraw.Draw(img)
            for sx, sg in ((w * 0.07, 1), (w * 0.93, -1)):
                for k in range(3):
                    x0 = sx + sg * k * h * 0.13
                    sd.polygon([(x0, h / 2 - h * 0.16), (x0 + sg * h * 0.12, h / 2), (x0, h / 2 + h * 0.16)],
                               outline=mix(col, (255, 255, 255), 0.5), width=4)
    # 老舊感：幾段燈管壞掉（暗掉）、整體髒污
    seed = sum(ord(c) for c in text)
    rnd = random.Random(seed)
    if rnd.random() < 0.45:
        px = img.load()
        for _ in range(rnd.randint(1, 2)):
            if vertical:
                y0 = rnd.randint(int(h * 0.15), int(h * 0.8)); y1 = y0 + rnd.randint(int(h * 0.04), int(h * 0.12))
                x0, x1 = 0, w
            else:
                x0 = rnd.randint(int(w * 0.15), int(w * 0.8)); x1 = x0 + rnd.randint(int(w * 0.03), int(w * 0.1))
                y0, y1 = 0, h
            reg = img.crop((x0, y0, x1, y1)).point(lambda v: int(v * 0.12))
            img.paste(reg, (x0, y0))
    img = grime(img, seed, 0.3, streak=True)
    return img


def make_signs():
    h_atlas = Image.new('RGB', (2048, 2048), (0, 0, 0))
    for i, (t, c) in enumerate(S.SIGNS_H):
        col, row = i % 2, i // 2
        h_atlas.paste(sign_cell(1024, 256, t, c), (col * 1024, row * 256))
    save(h_atlas, 'signs_h.jpg', 90)
    v_atlas = Image.new('RGB', (2048, 2048), (0, 0, 0))
    for i, (t, c) in enumerate(S.SIGNS_V):
        col, row = i % 8, i // 8
        v_atlas.paste(sign_cell(256, 1024, t, c, vertical=True), (col * 256, row * 1024))
    save(v_atlas, 'signs_v.jpg', 90)
    big = Image.new('RGB', (2048, 2048), (0, 0, 0))
    for i, (t, c) in enumerate(S.SIGNS_BIG):
        big.paste(sign_cell(2048, 512, t, c, stars=True), (0, i * 512))
    save(big, 'signs_big.jpg', 90)


# ───────────────────────── 大樓立面 ─────────────────────────
FAC_STYLE = [
    ('#1f2b36', ['#bfe9ff', '#8ae8ff', '#fff2b0', '#ffb070']),
    ('#1c2a3a', ['#8ae8ff', '#bfe9ff', '#ffffff', '#ff7ab0']),
    ('#172a2e', ['#7affd9', '#ffd96a', '#8ae8ff', '#d0f0ff']),
    ('#26282c', ['#ffe08a', '#ffc96a', '#fff2c0']),
    ('#3a1e24', ['#ffb066', '#ff8a5a', '#ffe0a0']),
    ('#14302e', ['#7affb0', '#b0ffe0', '#7ae8ff']),
]


# 立面不再手繪：用 ambientCG（CC0）的夜景立面實拍材質（含窗內窗簾、人影的發光圖），
# 再把發光圖染成各街區的霓虹色調。來源與授權見 assets/pbr/CREDITS.md。
ACG_SRC = HERE / 'acg_src'


def acg_get(asset):
    """下載並解壓 ambientCG 的 1K-JPG 包（只留要用的圖），回傳資料夾。已存在就略過。"""
    import io
    import urllib.request
    import zipfile
    d = ACG_SRC / asset
    if (d / f'{asset}_1K-JPG_Color.jpg').exists():
        return d
    d.mkdir(parents=True, exist_ok=True)
    url = f'https://ambientcg.com/get?file={asset}_1K-JPG.zip'
    print('   下載', url)
    req = urllib.request.Request(url, headers={'User-Agent': 'pie-game-asset-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for n in z.namelist():
            if n.endswith(('_Color.jpg', '_Emission.jpg', '_NormalGL.jpg', '_Roughness.jpg', '_Metalness.jpg', '_Opacity.jpg')):
                (d / Path(n).name).write_bytes(z.read(n))
    return d


def tint_field(size, colors, seed, cells=7):
    """可無縫平鋪的柔和色塊場：同一區的窗戶同色調，區與區之間漸變。"""
    rnd = random.Random(seed)
    small = Image.new('RGB', (cells, cells))
    small.putdata([hx(rnd.choice(colors)) if isinstance(colors[0], str) else rnd.choice(colors) for _ in range(cells * cells)])
    big = Image.new('RGB', (cells * 3, cells * 3))
    for i in range(3):
        for j in range(3):
            big.paste(small, (i * cells, j * cells))
    big = big.resize((size * 3, size * 3), Image.BICUBIC)
    return big.crop((size, size, size * 2, size * 2))


def make_facade(i):
    asset, tile_m = S.FAC_SRC[i]
    wall_h, lights = FAC_STYLE[i]
    d = acg_get(asset)
    ld = lambda k: Image.open(d / f'{asset}_1K-JPG_{k}.jpg')
    size = 1024
    wall = hx(wall_h)
    # 反照率：夜裡偏暗，並朝街區的牆色微微染色
    col = ld('Color').convert('RGB').resize((size, size), Image.LANCZOS)
    tint = tuple(min(255, int(v * 255 / max(wall))) for v in wall)
    col = Image.blend(col, ImageChops.multiply(col, Image.new('RGB', (size, size), tint)), 0.4).point(lambda v: int(v * 0.46))
    col = grime(col, 300 + i, 0.6, tile=True)
    save(col, f'fac_{i}_c.jpg', 84)
    # 發光：保留窗簾與人影的明暗，色調換成霓虹
    em = ld('Emission').convert('RGB').resize((size, size), Image.LANCZOS)
    lum = em.convert('L').point(lambda v: min(255, int(v * 1.35)))
    zones = tint_field(size, lights, 40 + i)
    neon = ImageChops.multiply(Image.merge('RGB', (lum, lum, lum)), zones)
    save(Image.blend(em, neon, 0.85), f'fac_{i}_e.jpg', 84)
    # 法線與材質遮罩（G＝粗糙度，B＝金屬度）
    save(ld('NormalGL').convert('RGB').resize((size, size), Image.LANCZOS), f'fac_{i}_n.jpg', 86)
    rough = ld('Roughness').convert('L').resize((size, size), Image.LANCZOS)
    metal = (ld('Metalness').convert('L').resize((size, size), Image.LANCZOS) if (d / f'{asset}_1K-JPG_Metalness.jpg').exists()
             else Image.new('L', (size, size), 0))
    zero = Image.new('L', (size, size), 0)
    save(Image.merge('RGB', (zero, rough, metal)), f'fac_{i}_m.jpg', 86)


# ───────────────────────── 店面 ─────────────────────────
def make_shop(key):
    """破舊的賽博店面：四種業態，部分鐵捲門半拉、塗鴉、剝落的海報；整張圖可無縫左右平鋪。"""
    rnd = random.Random({'N': 1, 'E': 2, 'S': 3, 'W': 4}[key])
    w, h = 1024, 512
    em = Image.new('RGB', (w, h), (4, 4, 8))        # 發光圖（也是亮處的底色）
    alb = None
    d = ImageDraw.Draw(em)
    bay = 256
    rust = [(86, 60, 44), (70, 74, 78), (92, 70, 52)]
    shutters = []
    for b in range(4):
        x0 = b * bay
        ix0, ix1, iy0, iy1 = x0 + 18, x0 + bay - 18, 70, h - 42
        if key == 'E':
            # 電玩店：一排排投幣機
            d.rectangle((ix0, iy0, ix1, iy1), fill=(10, 20, 44))
            blob(em, (ix0 + ix1) / 2, iy0 + 20, 190, (60, 190, 255), 0.4, 1.2)
            for k in range(3):
                cx = ix0 + 12 + k * 70
                cab = (cx, iy0 + 40, cx + 62, iy1)
                d.rectangle(cab, fill=(26, 26, 64))
                sc_ = rnd.choice([(90, 240, 255), (255, 90, 120), (255, 190, 60), (120, 255, 150)])
                d.rectangle((cx + 6, cab[1] + 28, cx + 56, cab[1] + 92), fill=mul(sc_, rnd.uniform(0.4, 0.85)))
                for _ in range(8):
                    px = rnd.randint(cx + 8, cx + 50); py = rnd.randint(cab[1] + 30, cab[1] + 88)
                    d.rectangle((px, py, px + 5, py + 5), fill=mix(sc_, (255, 255, 255), 0.6))
                d.rectangle((cx + 4, cab[1] + 6, cx + 58, cab[1] + 22), fill=rnd.choice([(255, 80, 120), (255, 170, 40), (40, 200, 255)]))
                d.rectangle((cx + 6, cab[1] + 104, cx + 56, cab[1] + 120), fill=(20, 20, 40))
                for q in range(3):
                    d.ellipse((cx + 10 + q * 16, cab[1] + 108, cx + 18 + q * 16, cab[1] + 116), fill=rnd.choice([(255, 60, 60), (60, 160, 255), (255, 230, 80)]))
        elif key == 'N':
            # 義體店：冷青色展示櫃，一格一格發光的義眼、義肢與晶片
            d.rectangle((ix0, iy0, ix1, iy1), fill=(6, 26, 32))
            blob(em, (ix0 + ix1) / 2, (iy0 + iy1) / 2, 200, (60, 220, 230), 0.45, 1.2)
            for r_ in range(3):
                sy = iy0 + 24 + r_ * 92
                d.rectangle((ix0 + 6, sy + 70, ix1 - 6, sy + 76), fill=(120, 200, 210))
                for k in range(3):
                    cx = ix0 + 30 + k * 62
                    kind = rnd.randrange(3)
                    c = rnd.choice([(120, 255, 240), (255, 120, 80), (180, 255, 150)])
                    if kind == 0:      # 義眼
                        d.ellipse((cx - 17, sy + 28, cx + 17, sy + 62), fill=mul(c, 0.8))
                        d.ellipse((cx - 7, sy + 38, cx + 7, sy + 52), fill=(6, 10, 14))
                    elif kind == 1:    # 義肢
                        d.rectangle((cx - 6, sy + 8, cx + 6, sy + 64), fill=mul(c, 0.65))
                        d.rectangle((cx - 12, sy + 36, cx + 12, sy + 42), fill=mul(c, 0.9))
                    else:              # 晶片
                        d.rectangle((cx - 16, sy + 34, cx + 16, sy + 62), fill=mul(c, 0.6))
                        for q in range(4):
                            d.line((cx - 16 + q * 10, sy + 62, cx - 16 + q * 10, sy + 70), fill=mul(c, 0.9), width=2)
        elif key == 'S':
            # 夜市：暖光、紅燈籠、攤位與蒸氣
            d.rectangle((ix0, iy0, ix1, iy1), fill=(70, 30, 10))
            blob(em, (ix0 + ix1) / 2, iy0 + 40, 200, (255, 140, 40), 0.55, 1.2)
            d.rectangle((ix0, iy1 - 70, ix1, iy1), fill=(110, 56, 24))
            d.rectangle((ix0, iy1 - 74, ix1, iy1 - 66), fill=(230, 170, 90))
            for k in range(4):
                cx = ix0 + 24 + k * 54
                d.line((cx, iy0, cx, iy0 + 26), fill=(220, 190, 140), width=2)
                d.ellipse((cx - 17, iy0 + 22, cx + 17, iy0 + 64), fill=(235, 50, 40))
                d.rectangle((cx - 9, iy0 + 20, cx + 9, iy0 + 26), fill=(220, 170, 60))
            for k in range(3):
                cx = ix0 + 20 + k * 68
                d.rectangle((cx, iy1 - 110, cx + 44, iy1 - 74), fill=rnd.choice([(230, 170, 80), (230, 100, 60), (230, 210, 150)]))
            blob(em, (ix0 + ix1) / 2, iy1 - 90, 90, (255, 220, 170), 0.3, 1.6)
        else:
            # 賽博巷：螢幕牆與伺服器機櫃
            d.rectangle((ix0, iy0, ix1, iy1), fill=(6, 22, 26))
            for gy in range(4):
                for gx in range(3):
                    sx, sy = ix0 + 8 + gx * 72, iy0 + 10 + gy * 62
                    c = rnd.choice([(80, 255, 200), (60, 200, 255), (200, 120, 255), (255, 90, 120)])
                    d.rectangle((sx, sy, sx + 64, sy + 54), fill=mul(c, rnd.uniform(0.2, 0.8)))
                    for _ in range(3):
                        yy = rnd.randint(sy + 6, sy + 46)
                        d.line((sx + 6, yy, sx + rnd.randint(20, 58), yy), fill=mix(c, (255, 255, 255), 0.55), width=2)
        # 天花燈管與地面反光
        d.rectangle((ix0, iy0 - 4, ix1, iy0 + 2), fill=(240, 250, 255) if key != 'S' else (255, 220, 160))
        blob(em, (ix0 + ix1) / 2, iy0, 120, (230, 240, 255), 0.22, 1.4)
        # 立柱
        d.rectangle((x0 - 6, 50, x0 + 8, h), fill=(10, 10, 16))
        d.rectangle((x0 + bay - 8, 50, x0 + bay + 8, h), fill=(10, 10, 16))
        if rnd.random() < 0.4:          # 鐵捲門半拉
            shutters.append((ix0 - 8, iy0 - 6, ix1 + 8, iy0 + int((iy1 - iy0) * rnd.uniform(0.5, 1.0))))
    d.rectangle((0, 0, w, 52), fill=(8, 8, 14))
    d.rectangle((0, h - 40, w, h), fill=(10, 10, 16))
    d.line((0, 52, w, 52), fill=(50, 56, 70), width=3)
    # 底色：亮處以發光圖為本，暗化；鐵捲門與牆面另外上色
    alb = em.point(lambda v: int(v * 0.30))
    da = ImageDraw.Draw(alb)
    for (sx0, sy0, sx1, sy1) in shutters:
        base = rnd.choice(rust)
        da.rectangle((sx0, sy0, sx1, sy1), fill=base)
        for yy in range(sy0, sy1, 7):
            da.line((sx0, yy, sx1, yy), fill=mul(base, 0.62), width=2)
        d.rectangle((sx0, sy0, sx1, sy1), fill=(2, 2, 4))      # 擋住裡面的光
        d.rectangle((sx0, sy1, sx1, sy1 + 3), fill=(2, 2, 4))
    # 塗鴉與剝落的海報（踢腳板與立柱）
    for _ in range(14):
        gx = rnd.randint(0, w - 80)
        gy = rnd.randint(h - 150, h - 44)
        c = rnd.choice([(255, 60, 160), (60, 230, 255), (255, 220, 70), (120, 255, 150)])
        pts = [(gx + rnd.randint(0, 70), gy + rnd.randint(-26, 26)) for _ in range(rnd.randint(3, 6))]
        da.line(pts, fill=mul(c, 0.7), width=rnd.randint(3, 6), joint='curve')
        d.line(pts, fill=mul(c, 0.32), width=rnd.randint(3, 6), joint='curve')
    for _ in range(6):
        px = rnd.randint(0, w - 40); py = rnd.randint(60, h - 140)
        pw, ph = rnd.randint(18, 34), rnd.randint(30, 52)
        c = rnd.choice([(200, 190, 170), (180, 120, 120), (120, 160, 170)])
        da.rectangle((px, py, px + pw, py + ph), fill=mul(c, 0.55))
    alb = grime(alb, 71 + ord(key), 0.55, tile=True)
    em = grime(em, 73 + ord(key), 0.25, tile=True)
    save(alb, f'shop_{key}_c.jpg', 86)
    save(em, f'shop_{key}_e.jpg', 88)


# ───────────────────────── 投幣機 / 販賣機 ─────────────────────────
def make_cabs():
    img = Image.new('RGB', (512, 1024), (0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(5)
    for i in range(4):
        col, row = i % 2, i // 2
        x0, y0 = col * 256, row * 512
        pal = [(60, 230, 255), (255, 90, 120), (255, 190, 60), (120, 255, 150)][i]
        d.rectangle((x0 + 6, y0 + 6, x0 + 250, y0 + 506), fill=(20, 18, 44))
        d.rectangle((x0 + 12, y0 + 12, x0 + 244, y0 + 80), fill=mul(pal, 0.9))       # 招牌
        for k in range(5):
            d.rectangle((x0 + 30 + k * 44, y0 + 40, x0 + 48 + k * 44, y0 + 52), fill=(255, 255, 255))
        sc = (x0 + 28, y0 + 100, x0 + 228, y0 + 300)                                   # 螢幕
        d.rectangle(sc, fill=(6, 8, 20))
        if i == 0:   # 太空射擊
            for _ in range(40):
                d.point((rnd.randint(sc[0], sc[2]), rnd.randint(sc[1], sc[3])), fill=(255, 255, 255))
            for r_ in range(3):
                for c_ in range(5):
                    d.rectangle((sc[0] + 24 + c_ * 34, sc[1] + 20 + r_ * 26, sc[0] + 40 + c_ * 34, sc[1] + 32 + r_ * 26), fill=(120, 255, 150))
            d.polygon([(x0 + 128, sc[3] - 36), (x0 + 112, sc[3] - 8), (x0 + 144, sc[3] - 8)], fill=(255, 255, 255))
        elif i == 1:  # 格鬥
            d.rectangle((sc[0], sc[3] - 40, sc[2], sc[3]), fill=(90, 40, 120))
            for fx, cc in ((sc[0] + 50, (255, 90, 90)), (sc[2] - 80, (90, 170, 255))):
                d.rectangle((fx, sc[1] + 90, fx + 30, sc[3] - 40), fill=cc)
                d.ellipse((fx + 3, sc[1] + 66, fx + 27, sc[1] + 90), fill=cc)
            d.rectangle((sc[0] + 10, sc[1] + 10, sc[0] + 90, sc[1] + 22), fill=(255, 230, 90))
            d.rectangle((sc[2] - 90, sc[1] + 10, sc[2] - 10, sc[1] + 22), fill=(255, 230, 90))
        elif i == 2:  # 賽車
            d.polygon([(x0 + 128, sc[1] + 10), (sc[2] - 6, sc[3]), (sc[0] + 6, sc[3])], fill=(60, 60, 80))
            for k in range(5):
                yy = sc[1] + 20 + k * 36
                d.rectangle((x0 + 124, yy, x0 + 132, yy + 12 + k * 3), fill=(255, 255, 255))
            d.rectangle((x0 + 116, sc[3] - 50, x0 + 140, sc[3] - 26), fill=(255, 80, 80))
        else:         # 節奏
            for lane in range(4):
                lx = sc[0] + 12 + lane * 46
                d.rectangle((lx, sc[1], lx + 40, sc[3]), fill=(24, 20, 50))
                for _ in range(3):
                    ny = rnd.randint(sc[1] + 6, sc[3] - 40)
                    d.rectangle((lx + 4, ny, lx + 36, ny + 14), fill=[(255, 90, 160), (90, 220, 255)][lane % 2])
            d.rectangle((sc[0], sc[3] - 22, sc[2], sc[3] - 14), fill=(255, 255, 255))
        d.rectangle((x0 + 20, y0 + 320, x0 + 236, y0 + 392), fill=(30, 28, 70))      # 控制台
        for k in range(4):
            d.ellipse((x0 + 40 + k * 46, y0 + 342, x0 + 70 + k * 46, y0 + 372), fill=[(255, 60, 60), (60, 160, 255), (255, 230, 80), (80, 255, 150)][k])
        d.rectangle((x0 + 98, y0 + 410, x0 + 158, y0 + 440), fill=(10, 10, 20))      # 投幣口
        d.rectangle((x0 + 118, y0 + 416, x0 + 138, y0 + 434), fill=(255, 220, 80))
    save(img, 'cabs.jpg', 88)


def make_vend():
    img = Image.new('RGB', (768, 512), (0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(8)
    pals = [((255, 150, 60), (255, 236, 215)), ((100, 255, 200), (230, 255, 245)), ((90, 200, 255), (225, 245, 255))]
    for i, (a, b) in enumerate(pals):
        x0 = i * 256
        d.rectangle((x0 + 6, 6, x0 + 250, 506), fill=mul(a, 0.35))
        d.rectangle((x0 + 14, 14, x0 + 242, 70), fill=a)
        d.rectangle((x0 + 98, 34, x0 + 158, 50), fill=(255, 255, 255))
        for r_ in range(4):
            for c_ in range(3):
                cx, cy = x0 + 36 + c_ * 66, 92 + r_ * 70
                d.rectangle((cx, cy, cx + 50, cy + 56), fill=b)
                d.rectangle((cx + 8, cy + 6, cx + 42, cy + 50), fill=rnd.choice([(255, 70, 90), (70, 200, 255), (255, 210, 70), (120, 255, 140), (200, 120, 255)]))
        d.rectangle((x0 + 30, 388, x0 + 226, 430), fill=(8, 8, 14))
        d.rectangle((x0 + 150, 440, x0 + 226, 490), fill=mul(a, 0.7))
        d.rectangle((x0 + 30, 440, x0 + 120, 490), fill=(8, 8, 14))
    save(img, 'vend.jpg', 88)


# ───────────────────────── 看板（Grok 生成的賽博龐克廣告圖） ─────────────────────────
def make_billboards():
    for name, (src, (tw, th_)) in S.BILLBOARDS.items():
        f = ART / src
        if not f.exists():
            raise SystemExit(f'缺 {f}：先用 art/prompt.md 請 Grok 生成看板圖')
        im = Image.open(f).convert('RGB')
        # 置中裁成目標比例，再縮到目標尺寸
        ar, tar = im.width / im.height, tw / th_
        if ar > tar:
            nw = int(im.height * tar)
            im = im.crop(((im.width - nw) // 2, 0, (im.width - nw) // 2 + nw, im.height))
        else:
            nh = int(im.width / tar)
            im = im.crop((0, (im.height - nh) // 2, im.width, (im.height - nh) // 2 + nh))
        im = im.resize((tw, th_), Image.LANCZOS)
        # 舊螢幕感：掃描線與髒污（發光貼圖，暗處不發光）
        px = im.load()
        for y in range(0, th_, 3):
            for x in range(tw):
                r_, g_, b_ = px[x, y]
                px[x, y] = (int(r_ * 0.78), int(g_ * 0.78), int(b_ * 0.78))
        im = grime(im, 90 + len(name), 0.35, streak=True)
        save(im, f'{name}.jpg', 86)


# ───────────────────────── 葉片圖集（ambientCG Leaf001／002／003，CC0） ─────────────────────────
def make_leaf_atlas():
    cells = []
    for asset in ('Leaf001', 'Leaf002', 'Leaf003', 'Leaf001'):
        d = acg_get(asset)
        col = Image.open(d / f'{asset}_1K-JPG_Color.jpg').convert('RGB').resize((256, 256), Image.LANCZOS)
        a = Image.open(d / f'{asset}_1K-JPG_Opacity.jpg').convert('L').resize((256, 256), Image.LANCZOS)
        # 透明處的顏色填成葉片平均色，避免縮圖與過濾時邊緣出現黑邊
        mean = tuple(int(v) for v in ImageChops.multiply(col, Image.merge('RGB', (a,) * 3)).resize((1, 1), Image.BOX).getpixel((0, 0)))
        cov = max(1, sum(a.getdata()) / 255 / (256 * 256))
        mean = tuple(min(255, int(v / cov)) for v in mean)
        col = Image.composite(col, Image.new('RGB', col.size, mean), a.point(lambda v: 255 if v > 24 else 0).filter(ImageFilter.MaxFilter(3)))
        col = col.point(lambda v: int(v * 0.8))          # 夜裡偏暗
        if len(cells) == 3:
            col, a = ImageOps.mirror(col), ImageOps.mirror(a)
        cells.append((col, a))
    atlas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    for i, (col, a) in enumerate(cells):
        im = col.convert('RGBA')
        im.putalpha(a)
        atlas.paste(im, ((i % 2) * 256, (i // 2) * 256))
    save(atlas, 'leaf_atlas.png')


# ───────────────────────── 地面 ─────────────────────────
PX_M = 64  # 大道貼圖（繪製時 2 倍取樣，輸出再縮成每公尺 32 像素）


def road_paint():
    pass


def make_avenue(key):
    a = S.AVENUES[key]
    dx, dz = a['d']
    nx, nz = -dz, dx
    T0, T1 = 24.0, S.L + 4
    w, h = int((T1 - T0) * PX_M), int(2 * S.W * PX_M)
    rnd = random.Random(ord(key))
    base = Image.new('RGB', (w, h), (22, 20, 34))
    nz_img = noise((w, h), 12, ord(key)).convert('RGB').point(lambda v: max(0, v - 120) // 4)
    img = ImageChops.add(base, nz_img)
    d = ImageDraw.Draw(img)
    em = Image.new('RGB', (w, h), (0, 0, 0))
    de = ImageDraw.Draw(em)
    y_of = lambda lat: int((lat + S.W) * PX_M)
    # 材質遮罩（R＝0 柏油／255 人行道，G＝粗糙度，B＝金屬度）。方磚與柏油顆粒由實拍細節層負責，手繪圖不再畫磚線
    mk_r = Image.new('L', (w, h), 0)
    mk_g = Image.new('L', (w, h), 84)                      # 柏油：微濕
    dr_, dg_ = ImageDraw.Draw(mk_r), ImageDraw.Draw(mk_g)
    # 人行道
    for lat0, lat1 in ((-S.W, -S.ROAD), (S.ROAD, S.W)):
        d.rectangle((0, y_of(lat0), w, y_of(lat1)), fill=(44, 40, 66))
        dr_.rectangle((0, y_of(lat0), w, y_of(lat1)), fill=255)
        dg_.rectangle((0, y_of(lat0), w, y_of(lat1)), fill=124)
    # 路緣
    for lat in (-S.ROAD, S.ROAD):
        d.rectangle((0, y_of(lat) - 9, w, y_of(lat) + 9), fill=(90, 84, 124))
    # 馬路標線
    for lat in (-5.5, 5.5):
        d.rectangle((0, y_of(lat) - 5, w, y_of(lat) + 5), fill=(150, 146, 176))
        dg_.rectangle((0, y_of(lat) - 5, w, y_of(lat) + 5), fill=140)
    x = int(5 * PX_M)
    while x < w:
        d.rectangle((x, y_of(0) - 5, x + int(3 * PX_M), y_of(0) + 5), fill=(220, 200, 90))
        dg_.rectangle((x, y_of(0) - 5, x + int(3 * PX_M), y_of(0) + 5), fill=140)
        de.rectangle((x, y_of(0) - 4, x + int(3 * PX_M), y_of(0) + 4), fill=(70, 60, 20))
        x += int(7 * PX_M)
    # 斑馬線（近廣場）
    for k in range(int(2 * S.ROAD / 0.9)):
        lat = -S.ROAD + 0.4 + k * 0.9
        d.rectangle((int(0.4 * PX_M), y_of(lat), int(3.8 * PX_M), y_of(lat + 0.45)), fill=(190, 186, 214))
        dg_.rectangle((int(0.4 * PX_M), y_of(lat), int(3.8 * PX_M), y_of(lat + 0.45)), fill=140)
    # 路緣霓虹（自發光）：用主題色
    col = hx(S.NEON[S.THEME[key]['neon'][0]][0])
    col2 = hx(S.NEON[S.THEME[key]['neon'][1]][0])
    for lat, c in ((-S.ROAD, col), (S.ROAD, col2)):
        de.rectangle((0, y_of(lat) - 6, w, y_of(lat) + 6), fill=c)
    # 反光釘
    for gx in range(0, w, int(4 * PX_M)):
        for lat in (-5.5, 5.5):
            de.ellipse((gx - 8, y_of(lat) - 8, gx + 8, y_of(lat) + 8), fill=(120, 230, 255))
    # 水窪
    pud = Image.new('RGB', (w, h), (0, 0, 0))
    dp = ImageDraw.Draw(pud)
    for _ in range(46):
        px = rnd.randint(0, w)
        lat = rnd.uniform(-S.ROAD + 0.5, S.ROAD - 0.5)
        rw, rh = rnd.randint(80, 300), rnd.randint(28, 80)
        dp.ellipse((px - rw, y_of(lat) - rh, px + rw, y_of(lat) + rh), fill=(26, 28, 52))
    pud = pud.filter(ImageFilter.GaussianBlur(12))
    img = ImageChops.add(img, pud)
    # 水窪在遮罩裡是近乎鏡面（粗糙度 ≈ 0.04），整條路另有大範圍的濕度起伏
    pud_l = pud.convert('L').point(lambda v: min(255, v * 7))
    wet = noise((w // 24, h // 24), 30, ord(key) + 5).resize((w, h), Image.BICUBIC).point(lambda v: max(0, min(255, (v - 128) // 4)))
    mk_g = ImageChops.subtract(mk_g, ImageChops.multiply(wet, Image.new('L', (w, h), 255)).point(lambda v: v // 2))
    mk_g = Image.composite(Image.new('L', (w, h), 10), mk_g, pud_l)
    mk_r = mk_r.filter(ImageFilter.GaussianBlur(6))
    mask = Image.merge('RGB', (mk_r, mk_g, Image.new('L', (w, h), 0)))
    # 光暈
    glow = Image.new('RGB', (w, h), (0, 0, 0))
    for g in S_GLOWS:
        t = g['x'] * dx + g['z'] * dz
        lat = g['x'] * nx + g['z'] * nz
        if t < T0 - g['r'] or t > T1 + g['r'] or abs(lat) > S.W + g['r']:
            continue
        if g['r'] <= 0:
            continue
        blob(glow, (t - T0) * PX_M, y_of(lat), g['r'] * PX_M, hx(g['c']), g['a'] * 0.5, 2.2)
    img = ImageChops.add(img, glow)
    img = grime(img, 66 + ord(key), 0.4, streak=False)
    half = (w // 2, h // 2)
    save(img.resize(half, Image.LANCZOS), f'ground_{key}_c.jpg', 86)
    save(em.resize((w // 4, h // 4), Image.LANCZOS), f'ground_{key}_e.jpg', 88)
    save(mask.resize((w // 4, h // 4), Image.LANCZOS), f'ground_{key}_m.jpg', 90)


def make_plaza():
    N = 4096
    ppm = N / (2 * S.RING)
    img = Image.new('RGB', (N, N), (22, 20, 34))
    d = ImageDraw.Draw(img)
    em = Image.new('RGB', (N, N), (0, 0, 0))
    de = ImageDraw.Draw(em)
    P = lambda x, z: ((x + S.RING) * ppm, (z + S.RING) * ppm)
    c = N / 2
    # 外圈人行道
    d.ellipse((c - S.RING * ppm, c - S.RING * ppm, c + S.RING * ppm, c + S.RING * ppm), fill=(44, 40, 66))
    # 廣場石板
    d.ellipse((c - S.R * ppm, c - S.R * ppm, c + S.R * ppm, c + S.R * ppm), fill=(30, 26, 52))
    # 材質遮罩：R＝0 廣場方磚／255 外圈人行道，G＝粗糙度。磚縫由實拍細節層負責，手繪圖不再畫格線
    mk_r = Image.new('L', (N, N), 255)
    ImageDraw.Draw(mk_r).ellipse((c - S.R * ppm, c - S.R * ppm, c + S.R * ppm, c + S.R * ppm), fill=0)
    mk_r = mk_r.filter(ImageFilter.GaussianBlur(5))
    mk_g = Image.new('L', (N, N), 96)
    ImageDraw.Draw(mk_g).ellipse((c - S.R * ppm, c - S.R * ppm, c + S.R * ppm, c + S.R * ppm), fill=78)
    # 水窪
    prnd = random.Random(31)
    pud = Image.new('L', (N, N), 0)
    dpp = ImageDraw.Draw(pud)
    for _ in range(30):
        a_, r_ = prnd.uniform(0, 6.283), prnd.uniform(3, S.R - 3)
        px_, py_ = c + math.cos(a_) * r_ * ppm, c + math.sin(a_) * r_ * ppm
        rw, rh = prnd.uniform(1.0, 3.2) * ppm, prnd.uniform(0.6, 1.8) * ppm
        dpp.ellipse((px_ - rw, py_ - rh, px_ + rw, py_ + rh), fill=255)
    pud = pud.filter(ImageFilter.GaussianBlur(0.25 * ppm))
    pud_l = pud.point(lambda v: min(255, v * 4))
    mk_g = Image.composite(Image.new('L', (N, N), 10), mk_g, pud_l)
    plaza_mask = Image.merge('RGB', (mk_r, mk_g, Image.new('L', (N, N), 0)))
    img = ImageChops.add(img, pud.point(lambda v: v // 10).convert('RGB'))
    d = ImageDraw.Draw(img)
    # 噪點
    img = ImageChops.add(img, noise((N, N), 9, 77).convert('RGB').point(lambda v: max(0, v - 122) // 4))
    d = ImageDraw.Draw(img)

    def ring(r, col, w_m=0.16, emi=True):
        rr = r * ppm
        d.ellipse((c - rr, c - rr, c + rr, c + rr), outline=mul(col, 0.8), width=max(2, int(w_m * ppm)))
        if emi:
            de.ellipse((c - rr, c - rr, c + rr, c + rr), outline=col, width=max(2, int(w_m * ppm)))

    pink, cyan, yel, vio = (255, 130, 40), (60, 230, 255), (255, 216, 74), (40, 220, 190)   # pink 其實是橘（舊名沿用）
    ring(S.R, pink, 0.22)
    ring(S.R - 1.2, cyan, 0.1)
    ring(11.0, vio, 0.14)
    ring(13.0, cyan, 0.1)
    ring(9.4, yel, 0.1)
    # 六角外框與內亮線（取代原本的星形）
    for rr_o, rr_i, col, wm in ((21.0, 8.6, pink, 0.2), (17.5, 7.2, yel, 0.1)):
        pts = []
        for i in range(12):
            r_ = rr_o if i % 2 == 0 else rr_i
            a = -math.pi / 2 + math.pi * i / 6
            pts.append((c + math.cos(a) * r_ * ppm, c + math.sin(a) * r_ * ppm))
        pts.append(pts[0])
        d.line(pts, fill=mul(col, 0.8), width=max(2, int(wm * ppm)), joint='curve')
        de.line(pts, fill=col, width=max(2, int(wm * ppm)), joint='curve')
    # 往四個出口的導引
    for ang in (0, 90, 180, 270):
        a = math.radians(ang)
        for off in (-1.2, 1.2):
            x0, z0 = 13 * math.cos(a) - off * math.sin(a), 13 * math.sin(a) + off * math.cos(a)
            x1, z1 = S.R * math.cos(a) - off * math.sin(a), S.R * math.sin(a) + off * math.cos(a)
            d.line((c + x0 * ppm, c + z0 * ppm, c + x1 * ppm, c + z1 * ppm), fill=(120, 230, 255), width=int(.12 * ppm))
            de.line((c + x0 * ppm, c + z0 * ppm, c + x1 * ppm, c + z1 * ppm), fill=(60, 200, 255), width=int(.12 * ppm))
    # 散落的電路焊點與短線
    rnd = random.Random(9)
    for _ in range(90):
        r_ = rnd.uniform(14, S.R - 2)
        a = rnd.uniform(0, 6.283)
        x, y = c + math.cos(a) * r_ * ppm, c + math.sin(a) * r_ * ppm
        cc = rnd.choice([pink, cyan, yel, vio])
        sz = rnd.uniform(.12, .3) * ppm
        ln = rnd.uniform(.6, 2.2) * ppm
        ca, sa = math.cos(a + 1.57 * rnd.randrange(2)), math.sin(a + 1.57 * rnd.randrange(2))
        for dd, col_, wd in ((de, mul(cc, 0.9), 0.07), (d, mul(cc, 0.45), 0.07)):
            dd.line((x, y, x + ca * ln, y + sa * ln), fill=col_, width=max(2, int(wd * ppm)))
            dd.ellipse((x - sz, y - sz, x + sz, y + sz), fill=col_)
    # 光暈
    glow = Image.new('RGB', (N, N), (0, 0, 0))
    for g in S_GLOWS:
        if math.hypot(g['x'], g['z']) > S.RING + g['r'] or g['r'] <= 0:
            continue
        x, y = P(g['x'], g['z'])
        blob(glow, x, y, g['r'] * ppm, hx(g['c']), g['a'] * 0.55, 2.2)
    img = ImageChops.add(img, glow)
    img = grime(img, 55, 0.4, streak=False)
    save(img.resize((2048, 2048), Image.LANCZOS), 'ground_plaza_c.jpg', 88)
    save(em.resize((2048, 2048), Image.LANCZOS), 'ground_plaza_e.jpg', 90)
    save(plaza_mask.resize((1024, 1024), Image.LANCZOS), 'ground_plaza_m.jpg', 90)


def main():
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else ''
    global S_GLOWS
    sc = S.build()
    S_GLOWS = sc.glows
    jobs = [('signs', make_signs), ('fac', lambda: [make_facade(i) for i in range(S.N_FAC)]),
            ('shop', lambda: [make_shop(k) for k in 'NESW']), ('cabs', make_cabs), ('vend', make_vend),
            ('bb', make_billboards), ('leaf', make_leaf_atlas), ('plaza', make_plaza), ('avenue', lambda: [make_avenue(k) for k in 'NESW'])]
    for name, fn in jobs:
        if only and not name.startswith(only):
            continue
        print(name)
        fn()


if __name__ == '__main__':
    main()
