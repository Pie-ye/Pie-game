#!/usr/bin/env python3
"""把挑好的圖做成 site/shell/city/assets/*.webp。
usage: process_art.py <來源資料夾> [--pick name=seed ...]   來源是 fetch.sh 下載的 PNG。
建築、人物、街機、機器人用去背版（_cut），並裁掉透明邊；天空與中景是整張圖。
沒有指定 seed 的名稱用 picks.json 的預設。"""
import json, sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[1] / 'site/shell/city/assets'
RAW = {'arcade'}
# 背景有第二輪（bg2-，seed 21 起用）

FULL = ('fac-', 'bg-')  # 外牆與街區背景：整張圖直接用，不去背
FLIP = {'hero'}  # 這張原圖朝左，城市裡預設朝右
src = Path(sys.argv[1])
picks = json.loads((HERE / 'picks.json').read_text())
for arg in sys.argv[2:]:
    if '=' in arg:
        name, seed = arg.split('=', 1); picks[name] = int(seed)
ASSETS.mkdir(parents=True, exist_ok=True)

def save(img, out, q, max_h=None):
    if max_h and img.height > max_h:
        img = img.resize((round(img.width * max_h / img.height), max_h), Image.LANCZOS)
    img.save(ASSETS / out, quality=q, method=6)
    print('wrote', out, img.size, (ASSETS / out).stat().st_size // 1024, 'KB')

for name, seed in picks.items():
    if name.startswith(FULL) or name in ('sky', 'mid'):
        if name.startswith('bg-') and seed >= 20:  # 第二輪背景（bg2-），seed 20 + 原 seed
            f = src / f"{name.replace('bg-', 'bg2-')}_{seed - 20}.png"
        else:
            f = src / f"{name.replace('fac-', 'cz-' if seed >= 10 else 'wall-')}_{seed}.png"  # 外牆來源：seed>=10 是第四輪賽博賭場外牆（cw-），其餘是第三輪（wall-）
        if f.exists(): save(Image.open(f).convert('RGB'), f'{name}.webp', 80)
        else: print('missing', f)
        continue
    if name in RAW:  # 街機是正面特寫、整張都是機台，不去背
        f = src / f'{name}_{seed}.png'
        if f.exists(): save(Image.open(f).convert('RGB'), f'{name}.webp', 86, max_h=1100)
        continue
    f = src / f'{name.replace("bld-", "b2-")}_{seed}_cut.png'  # 建築用第二輪（b2-）的圖
    if not f.exists():
        print('missing', f); continue
    img = Image.open(f).convert('RGBA')
    box = img.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
    if box: img = img.crop(box)
    if name in FLIP: img = img.transpose(Image.FLIP_LEFT_RIGHT)
    save(img, f'{name}.webp', 86, max_h=1100 if name.startswith('bld-') or name == 'arcade' else 900)
