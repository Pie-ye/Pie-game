#!/usr/bin/env python3
"""賭場遊戲畫面截圖（搭配 tools/dev_stub_api.py）。usage: casino_shots.py <輸出資料夾> [theme=cyber|playful]"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
theme = sys.argv[2] if len(sys.argv) > 2 else 'cyber'
BASE = 'http://localhost:54470/?api=http://127.0.0.1:54480&content=http://127.0.0.1:54471'

def go(page, game):
    page.goto(f'{BASE}#/game/{game}'); page.wait_for_timeout(1500)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1100, 'height': 900})
    page.add_init_script(f"localStorage.setItem('pg_theme','{theme}')")
    page.goto(BASE); page.wait_for_timeout(1500); page.screenshot(path=out / 'lobby.png')
    go(page, 'slots'); page.screenshot(path=out / 'slots0.png')
    page.click('[data-action=slot-spin]'); page.wait_for_timeout(4500); page.screenshot(path=out / 'slots1.png')
    go(page, 'blackjack'); page.click('[data-action=bj-deal]'); page.wait_for_timeout(900); page.screenshot(path=out / 'bj0.png')
    page.click('[data-act=stand]'); page.wait_for_timeout(900); page.screenshot(path=out / 'bj1.png')
    go(page, 'dragon'); page.click('[data-action=dg-deal]'); page.wait_for_timeout(900); page.screenshot(path=out / 'dg0.png')
    page.click('[data-action=dg-bet]'); page.wait_for_timeout(900); page.screenshot(path=out / 'dg1.png')
    go(page, 'niuniu'); page.screenshot(path=out / 'nn0.png'); page.click('[data-action=nn-play]'); page.wait_for_timeout(900); page.screenshot(path=out / 'nn1.png')
    go(page, 'baccarat'); page.screenshot(path=out / 'bc0.png'); page.click('[data-action=bc-deal]'); page.wait_for_timeout(1500); page.screenshot(path=out / 'bc1.png')
    for gid in ('coin-flip', 'lucky-wheel'):
        go(page, gid); page.wait_for_timeout(1000); page.screenshot(path=out / f'{gid}0.png')
        btns = page.locator('#coinBetBar .primary-button')
        if btns.count():
            btns.first.click(); page.wait_for_timeout(3500); page.screenshot(path=out / f'{gid}1.png')
    b.close()
print('ok', out)
