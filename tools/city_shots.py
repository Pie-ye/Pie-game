#!/usr/bin/env python3
"""遊戲城截圖與操作檢查（搭配 server.app --dev 與 tools/dev_stub_api.py）。usage: city_shots.py <輸出資料夾>"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:54470/?api=http://127.0.0.1:54480&content=http://127.0.0.1:54471'
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1280, 'height': 760})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(BASE); page.wait_for_selector('.city-canvas'); page.wait_for_timeout(2600)
    page.screenshot(path=out / 'city0.png')
    page.keyboard.down('ArrowRight'); page.keyboard.down('Shift'); page.wait_for_timeout(1500)
    page.keyboard.up('ArrowRight'); page.keyboard.up('Shift'); page.wait_for_timeout(700)
    page.screenshot(path=out / 'city1.png')
    # 點地圖上的第一個點走到門前
    page.click('.city-map-dot >> nth=0'); page.wait_for_timeout(3500)
    page.screenshot(path=out / 'city2.png')
    print('plaque:', page.inner_text('#cityPlaque') if page.locator('#cityPlaque:not([hidden])').count() else 'none')
    page.keyboard.press('ArrowUp'); page.wait_for_timeout(900)
    page.screenshot(path=out / 'boot0.png'); page.wait_for_timeout(1000)
    page.screenshot(path=out / 'boot1.png'); page.wait_for_timeout(900)
    page.screenshot(path=out / 'boot2.png'); page.wait_for_timeout(2500)
    print('hash:', page.evaluate('location.hash'), 'overlay:', page.locator('#arcadeBoot').count())
    page.screenshot(path=out / 'game.png')
    page.go_back(); page.wait_for_selector('.city-canvas', timeout=8000); page.wait_for_timeout(800)
    page.screenshot(path=out / 'back.png')
    page.set_viewport_size({'width': 390, 'height': 760}); page.wait_for_timeout(600)
    page.screenshot(path=out / 'mobile.png')
    b.close()
print('errors:', errors)
