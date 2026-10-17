#!/usr/bin/env python3
"""把主角貼圖切成可骨架動畫的部位（city/assets/hero-*.webp，全部和原圖同尺寸、座標一致）：
body＝去掉兩隻手臂與兩條腿的身體（手臂原位補上外套色，不會出現殘影）；armA＝遠側高舉的手臂（畫在身體後面）；
armB＝近側向前的手臂（畫在身體前面）。腿與鞋由 city.js 用程式畫（兩節骨頭加反向運動學，才有膝蓋與離地）。
座標是佔整張圖的比例，換人物貼圖時要重新量。"""
from pathlib import Path
from PIL import Image, ImageDraw
A = Path(__file__).resolve().parents[2] / 'site/shell/city/assets'
src = Image.open(A / 'hero.webp').convert('RGBA'); W, H = src.size
ARM_A = [(0.78, 0.10), (0.97, 0.10), (0.97, 0.36), (0.82, 0.47), (0.64, 0.43), (0.66, 0.34), (0.78, 0.33)]
ARM_B = [(0.58, 0.43), (0.82, 0.43), (0.98, 0.51), (0.98, 0.63), (0.80, 0.61), (0.60, 0.57)]
PATCH = [(0.56, 0.44), (0.64, 0.44), (0.67, 0.50), (0.68, 0.58), (0.58, 0.60)]  # 手臂原位下方的外套
LEG_TOP = 0.775
def mask(poly):
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon([(x * W, y * H) for x, y in poly], fill=255); return m
def cut(m):
    out = src.copy(); a = out.getchannel('A'); out.putalpha(Image.composite(a, Image.new('L', (W, H), 0), m)); return out
ma, mb = mask(ARM_A), mask(ARM_B)
cut(ma).save(A / 'hero-armA.webp', quality=90, method=6)
cut(mb).save(A / 'hero-armB.webp', quality=90, method=6)
body = src.copy(); alpha = body.getchannel('A')
keep = Image.eval(Image.composite(Image.new('L', (W, H), 0), Image.new('L', (W, H), 255), Image.composite(ma, mb, ma)), lambda v: v)
# 去掉手臂區域
armmask = Image.new('L', (W, H), 0); armmask.paste(255, mask=ma); armmask.paste(255, mask=mb)
alpha = Image.composite(Image.new('L', (W, H), 0), alpha, armmask)
# 在被挖掉的外套位置補一塊外套色（只補原本不透明處的鄰近範圍）
patch = Image.new('RGBA', (W, H), (246, 176, 102, 255)); pm = mask(PATCH)
body.putalpha(alpha); body.paste(patch, mask=Image.composite(pm, Image.new('L', (W, H), 0), mb))
# 去掉腿（裙擺以下）
a2 = body.getchannel('A'); cutleg = Image.new('L', (W, H), 255); ImageDraw.Draw(cutleg).rectangle([0, int(LEG_TOP * H), W, H], fill=0)
body.putalpha(Image.composite(a2, Image.new('L', (W, H), 0), cutleg))
body.save(A / 'hero-body.webp', quality=90, method=6)
print('ok', [p.name for p in A.glob('hero-*.webp')])
