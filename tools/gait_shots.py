#!/usr/bin/env python3
"""把城市主角固定在 8 個步態相位各截一張，拼成 /tmp/gait-final.png（用 canvas 的 data-freeze）。搭配 server.app --dev。"""
import math
from playwright.sync_api import sync_playwright
from PIL import Image
BASE = 'http://localhost:54470/?api=http://127.0.0.1:54480&content=http://127.0.0.1:54471'
n = 8
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_context(viewport={'width': 1280, 'height': 760}, device_scale_factor=2).new_page()
    page.goto(BASE); page.wait_for_selector('.city-canvas'); page.wait_for_timeout(3000)
    for i in range(n):
        page.evaluate(f"document.querySelector('.city-canvas').dataset.freeze='{2 * math.pi * i / n}'"); page.wait_for_timeout(300)
        page.screenshot(path=f'/tmp/r{i}.png', clip={'x': 330, 'y': 450, 'width': 260, 'height': 270})
    b.close()
s = Image.new('RGB', (520 * 4, 540 * 2))
for i in range(n): s.paste(Image.open(f'/tmp/r{i}.png'), ((i % 4) * 520, (i // 4) * 540))
s.save('/tmp/gait-final.png'); print('ok')
