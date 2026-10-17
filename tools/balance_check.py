#!/usr/bin/env python3
"""金幣顯示對帳：玩幾局後，右上角的數字必須等於伺服器 /api/casino/session 的餘額（含進出城市與分頁切換）。"""
import json, re, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:54470/?api=http://127.0.0.1:54480&content=http://127.0.0.1:54471'
def server(): return json.load(urllib.request.urlopen('http://127.0.0.1:54480/api/casino/session'))['balance']
def pill(page): return int(re.sub(r'\D', '', page.inner_text('#balancePill b')))
bad = []
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={'width': 1280, 'height': 800})
    page.goto(BASE + '#/game/slots'); page.wait_for_selector('[data-action=slot-spin]'); page.wait_for_timeout(1200)
    for i in range(4):
        page.click('[data-action=slot-spin]'); page.wait_for_timeout(5200)
        a, s = pill(page), server(); print('slots', i, a, s)
        if a != s: bad.append(('slots', a, s))
    page.goto(BASE + '#/game/blackjack'); page.wait_for_selector('[data-action=bj-deal]'); page.click('[data-action=bj-deal]'); page.wait_for_timeout(1500)
    if page.locator('[data-act=stand]').count(): page.click('[data-act=stand]'); page.wait_for_timeout(1500)
    a, s = pill(page), server(); print('blackjack', a, s)
    if a != s: bad.append(('bj', a, s))
    page.goto(BASE + '#/'); page.wait_for_selector('.city-canvas'); page.wait_for_timeout(1500)
    a, s = pill(page), server(); print('city', a, s)
    if a != s: bad.append(('city', a, s))
    b.close()
print('MISMATCH' if bad else 'OK', bad)
