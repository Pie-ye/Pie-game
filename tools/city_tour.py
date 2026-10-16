#!/usr/bin/env python3
"""逐棟走到每扇門前截圖，拼成一張聯絡表。usage: city_tour.py <輸出資料夾>（搭配 server.app --dev 與 dev_stub_api.py）"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:54470/?api=http://127.0.0.1:54480&content=http://127.0.0.1:54471'
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={'width': 1280, 'height': 760})
    page.goto(BASE); page.wait_for_selector('.city-canvas'); page.wait_for_timeout(2600)
    n = page.locator('.city-map-dot').count(); shots = []
    for i in range(n):
        page.locator('.city-map-dot').nth(i).click(); page.wait_for_timeout(5200 if i else 3500)
        f = out / f'tour{i:02d}.png'; page.screenshot(path=f); shots.append(f)
    b.close()
cols = 3; w, h = 640, 380; rows = (len(shots) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows))
for i, f in enumerate(shots): sheet.paste(Image.open(f).resize((w, h)), ((i % cols) * w, (i // cols) * h))
sheet.save(out / 'tour.png'); print('ok', n)
