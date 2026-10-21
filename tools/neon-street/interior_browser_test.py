#!/usr/bin/env python3
"""Focused browser smoke test for the CC0-modelled arcade interior."""
from playwright.sync_api import sync_playwright

import os
BASE = os.environ.get('ARCADE_TEST_ORIGIN', 'http://127.0.0.1:18770') + '/games/community/neon-arcade-street/index.html?autoq=0&solo=1&fps=30'
MOBILE = os.environ.get('ARCADE_TEST_MOBILE') == '1'

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'])
    page = browser.new_page(viewport={'width': 390, 'height': 844} if MOBILE else {'width': 640, 'height': 360}, is_mobile=MOBILE, has_touch=MOBILE, reduced_motion='reduce' if MOBILE else 'no-preference')
    errors = []
    failed_assets = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('response', lambda response: failed_assets.append(response.url) if response.status >= 400 and '/assets/' in response.url else None)
    page.goto(BASE)
    page.wait_for_function('window.__street && window.__street.mode === "title"', timeout=120000)
    page.click('#start')
    page.wait_for_function("window.__street.mode === 'play'", timeout=10000)
    page.evaluate('__street.setPose(10.45, 49.1, 0, 0)')
    page.wait_for_function("document.getElementById('interact-btn').classList.contains('on')", timeout=10000)
    if MOBILE:
        page.tap('#interact-btn')
    else:
        page.keyboard.press('KeyE')
    page.wait_for_function("document.getElementById('zone-name').textContent.includes('星光電玩屋')", timeout=10000)
    page.screenshot(path='/tmp/arcade-entry-view.png')
    page.keyboard.down('KeyW')
    page.wait_for_function('__street.player.z < -239', timeout=15000)
    page.keyboard.up('KeyW')
    assert page.evaluate('__street.player.z') < -239
    page.screenshot(path='/tmp/arcade-interior.png')
    page.keyboard.press('KeyE')
    assert page.evaluate('__street.interior'), 'E must not exit away from the door'
    # Walking directly into a cabinet must stop at its footprint.
    page.evaluate('__street.setPose(-4.5, -240, 0, 0)')
    page.keyboard.down('KeyW')
    page.wait_for_function('__street.player.z < -241', timeout=15000)
    page.wait_for_timeout(1500)
    page.keyboard.up('KeyW')
    assert page.evaluate('__street.player.z') > -242, 'cabinet collision'
    print('render', page.evaluate('__street.stats()'))
    print('colliders', page.evaluate('__street.interiorWorld.colliders.length'))
    page.evaluate('__street.setPose(-4.5, -241.2, 0, 0)')
    page.keyboard.press('KeyE')
    page.wait_for_selector('#arcade-game[open]')
    page.click('#arcade-start')
    if MOBILE:
        page.locator('[data-pad][data-active="true"]').tap()
    else:
        page.locator('[data-pad][data-active="true"]').click()
    page.wait_for_function("document.getElementById('arcade-status').textContent.includes('得分 1')")
    page.screenshot(path='/tmp/arcade-play.png')
    page.click('#arcade-close')
    page.wait_for_function('__street.mode === "pause"')
    page.click('#resume')
    page.wait_for_function('__street.mode === "play"')
    assert page.evaluate('__street.interior'), 'return from cabinet keeps player indoors'
    page.evaluate('__street.setPose(0, -236.7, 3.1415926, 0)')
    page.wait_for_function("document.getElementById('interact-btn').classList.contains('on')", timeout=10000)
    if MOBILE:
        page.tap('#interact-btn')
    else:
        page.keyboard.press('KeyE')
    page.wait_for_function("document.getElementById('zone-name').textContent.includes('夜市')", timeout=10000)
    assert not errors, errors
    assert not failed_assets, failed_assets
    print('INTERIOR SMOKE PASS')
    browser.close()
