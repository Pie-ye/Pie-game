#!/usr/bin/env python3
"""13 款遊戲介面＋登入＋城市的截圖與聯絡表（搭配 server.app --dev 與 tools/dev_stub_api.py）。usage: ui_shots.py <輸出資料夾>"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:54470/?api=http://127.0.0.1:54480&content=http://127.0.0.1:54471'
IDS = ['slots', 'blackjack', 'baccarat', 'niuniu', 'dragon', 'texas-holdem', 'coin-flip', 'lucky-wheel',
       'pie-phoebe', 'phoebe-egg', 'phoebe-peak', 'snake', 'tic-tac-toe']
shots = []
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={'width': 1280, 'height': 800})
    page.goto(BASE + '#/login'); page.wait_for_timeout(1500); page.screenshot(path=out / 'login.png'); shots.append(out / 'login.png')
    page.goto(BASE); page.wait_for_selector('.city-canvas'); page.wait_for_timeout(2500); page.screenshot(path=out / 'city.png'); shots.append(out / 'city.png')
    for i in IDS:
        page.goto(BASE + '#/game/' + i); page.wait_for_timeout(4200)
        if i == 'slots': page.click('[data-action=slot-spin]'); page.wait_for_timeout(4800)
        if i == 'blackjack': page.click('[data-action=bj-deal]'); page.wait_for_timeout(1200)
        if i == 'baccarat': page.click('[data-action=bc-deal]'); page.wait_for_timeout(2200)
        if i == 'niuniu': page.click('[data-action=nn-play]'); page.wait_for_timeout(1500)
        if i == 'dragon': page.click('[data-action=dg-deal]'); page.wait_for_timeout(1200)
        f = out / f'{i}.png'; page.screenshot(path=f); shots.append(f)
    b.close()
cols = 3; w, h = 640, 400; rows = (len(shots) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows))
for k, f in enumerate(shots): sheet.paste(Image.open(f).resize((w, h)), ((k % cols) * w, (k // cols) * h))
sheet.save(out / 'sheet.png'); print('ok', len(shots))
