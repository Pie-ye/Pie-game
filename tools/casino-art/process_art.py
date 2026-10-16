#!/usr/bin/env python3
"""把 Colab 產的 gwentCB01 原圖挑選、裁切、轉 webp，輸出到 site/shell/casino/（外框與官方賭場遊戲用）。
usage: process_art.py <round1資料夾> <round2資料夾> [out]
挑圖（seed）寫死在 PICK，是人工看過 contact sheet 後選的；按鈕底板由挑好的材質貼圖合成。"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

R1, R2 = Path(sys.argv[1]), Path(sys.argv[2])
OUT = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parents[2] / 'site/shell/casino'
OUT.mkdir(parents=True, exist_ok=True)

def save(im, name, size=None, q=82):
    if size: im = im.resize(size, Image.LANCZOS)
    im.save(OUT / f'{name}.webp', quality=q, method=6)
    print(name, im.size, (OUT / f'{name}.webp').stat().st_size)

def load(root, name, cut=False):
    return Image.open(root / f'{name}{"_cut" if cut else ""}.png').convert('RGBA' if cut else 'RGB')

def trim(im):
    box = im.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()
    return im.crop(box) if box else im

# 卡背（直式 2:3）
save(load(R2, 'cardback_6'), 'cardback', (320, 480))
# 材質（可無縫拼貼）
def tex(root, name, out, size=256, bright=1.0, sat=1.0):
    im = load(root, name).resize((size, size), Image.LANCZOS)
    if bright != 1.0: im = ImageEnhance.Brightness(im).enhance(bright)
    if sat != 1.0: im = ImageEnhance.Color(im).enhance(sat)
    save(im, out)
    return im
felt = tex(R2, 'tex_felt_green_5', 'tex-felt', bright=0.55, sat=0.8)
tex(R2, 'tex_felt_red_5', 'tex-felt-red', bright=0.8)
leather = tex(R1.parent / 'r1', 'tex_leather_2', 'tex-leather', bright=0.85)
gold = tex(R2, 'tex_gold_4', 'tex-gold')
ruby = tex(R1.parent / 'r1', 'tex_ruby_4', 'tex-ruby')
ruby_smooth = ImageEnhance.Brightness(ruby.filter(ImageFilter.GaussianBlur(3))).enhance(1.25)
save(ruby_smooth, 'tex-ruby-smooth')
iron = tex(R1.parent / 'r1', 'tex_iron_2', 'tex-iron')
steel = tex(R2, 'tex_steel_6', 'tex-steel')
tex(R1.parent / 'r1', 'tex_stone_2', 'tex-stone', bright=0.6)
jade = tex(R2, 'tex_jade_6', 'tex-jade', bright=0.8)
tex(R2, 'tex_felt_blue_5', 'tex-navy', bright=0.9)
# 牌面：米色羊皮紙，提亮到文字看得清楚
parch = Image.blend(load(R2, 'tex_parchment_4').resize((256, 256), Image.LANCZOS), Image.new('RGB', (256, 256), (244, 232, 204)), 0.55)
save(parch, 'tex-parchment')
# 符號貼圖（方形，CSS 圓角）
for name, src in {
    'crown': ('sym_crown_2'), 'gem': 'sym_gem_2', 'rocket': 'sym2_rocket_6', 'bank': 'sym_bank_3',
    'flame': 'sym_flame_3', 'trend': 'sym2_trend_1', 'candles': 'sym2_candles_1', 'coins': 'sym2_coins_5',
}.items():
    im = load(R1 if not src.startswith('sym2') else R2, src)
    save(im, f'sym-{name}', (192, 192))
# 硬幣、籌碼、轉盤中心與指針（去背）
save(trim(load(R2, 'coin_heads_4', True)), 'coin-heads', (256, 256), 88)
save(trim(load(R2, 'coin_tails_3', True)), 'coin-tails', (256, 256), 88)
save(trim(load(R2, 'chip_gold_4', True)), 'chip', (128, 128), 88)
save(trim(load(R2, 'chip_ruby_2', True)), 'chip-active', (128, 128), 88)
save(trim(load(R2, 'wheel_hub_4', True)), 'wheel-hub', (160, 160), 88)
ptr = trim(load(R2, 'pointer_2', True))
ptr = ptr.crop((0, 0, ptr.width, int(ptr.height * 0.5)))
save(trim(ptr), 'wheel-pointer', None, 88)

# 按鈕底板：材質填滿＋圓角＋立體邊框（9 宮格切片用，CSS 邊框 6px）
def plate(fill, rim, name, size=(128, 64), radius=10, rim_w=6, dim=1.0):
    w, h = size; S = 4
    mask = Image.new('L', (w * S, h * S), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * S - 1, h * S - 1), radius * S, fill=255)
    mask = mask.resize(size, Image.LANCZOS)
    body = fill.resize(size, Image.LANCZOS)
    if dim != 1.0: body = ImageEnhance.Brightness(body).enhance(dim)
    edge = rim.resize(size, Image.LANCZOS)
    inner = Image.new('L', (w * S, h * S), 0)
    ImageDraw.Draw(inner).rounded_rectangle((rim_w * S, rim_w * S, (w - rim_w) * S - 1, (h - rim_w) * S - 1), (radius - 3) * S, fill=255)
    inner = inner.resize(size, Image.LANCZOS)
    im = Image.composite(body, edge, inner)
    # 立體感：上緣亮、下緣暗
    shade = Image.linear_gradient('L').resize(size)
    hi = ImageChops.multiply(shade.point(lambda v: 255 - v), Image.new('L', size, 70))
    lo = ImageChops.multiply(shade, Image.new('L', size, 90))
    im = Image.composite(Image.new('RGB', size, (255, 240, 200)), im, hi)
    im = Image.composite(Image.new('RGB', size, (0, 0, 0)), im, lo)
    out = im.convert('RGBA'); out.putalpha(mask)
    save(out, name, None, 90)
plate(ruby, gold, 'btn-primary', dim=0.9)
plate(iron, steel, 'btn-secondary', dim=0.8)
gold_smooth = ImageEnhance.Brightness(gold.filter(ImageFilter.GaussianBlur(4))).enhance(1.05)
plate(gold_smooth, gold, 'btn-gold', dim=1.0)
plate(leather, gold, 'panel', size=(128, 128), radius=14, rim_w=5, dim=0.7)

# 投稿遊戲在 iframe 裡跑，跨 origin 取不到外框的貼圖，所以各自帶一份到 assets/。
import shutil
GAME_ASSETS = {
    'coin-flip': ['coin-heads', 'coin-tails', 'tex-felt', 'btn-secondary', 'btn-gold', 'btn-primary', 'panel'],
    'lucky-wheel': ['tex-gold', 'tex-ruby-smooth', 'tex-jade', 'tex-navy', 'tex-leather', 'tex-iron', 'tex-stone', 'tex-steel',
                    'wheel-hub', 'wheel-pointer', 'tex-felt', 'panel'],
}
for game, names in GAME_ASSETS.items():
    dest = OUT.parents[1] / 'games/community' / game / 'assets'
    dest.mkdir(parents=True, exist_ok=True)
    for n in names:
        shutil.copy(OUT / f'{n}.webp', dest / f'{n}.webp')
