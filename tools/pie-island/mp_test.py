#!/usr/bin/env python3
"""小島樂園瀏覽器測試：捏臉流程、多人互見（位置、外觀、表情）、離開、單機退路，並截圖。

先起測試台：python3 tools/pie-island/harness.py   （port 18780）
用法：python3 tools/pie-island/mp_test.py [截圖資料夾]
環境變數 ISLAND_TEST_ORIGIN 可換測試台位址。
"""
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/pie-island-mp'); out.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('ISLAND_TEST_ORIGIN', 'http://127.0.0.1:18780')
Q = '&autoq=0&fps=15&shadows=0'
errors, fails = [], []
ALICE_LOOK = [2, 1, 2, 1, 1, 1, 1, 6, 5, 1, 2, 9, 0, 0, 13, 4, 0, 0]
BOB_LOOK = [1, 0, 0, 1, 1, 0, 1, 5, 3, 0, 1, 4, 4, 0, 9, 2, 1, 0]


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)


def game_frame(page):
    page.wait_for_selector('iframe')
    for _ in range(100):
        for f in page.frames:
            if 'pie-island' in f.url:
                return f
        page.wait_for_timeout(100)
    raise RuntimeError('no game frame')


def open_user(browser, name, look):
    ctx = browser.new_context(viewport={'width': 800, 'height': 500})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
    page.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' else None)
    page.goto(f'{BASE}/fake-shell.html?u={name}&q={Q}')
    fr = game_frame(page)
    fr.wait_for_function('window.__island && window.__island.world', timeout=240000)
    fr.wait_for_function("__island.net.status.mode === 'online'", timeout=30000)
    # 第一次進島：先開捏臉，選好再完成
    fr.locator('#start').click()
    fr.wait_for_function("__island.mode === 'create'")
    fr.evaluate('l => __island.creator.show(l, { first: true })', look)
    fr.locator('#creator-done').click()
    fr.wait_for_function("__island.mode === 'play'")
    return page, fr


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'])

    pa, fa = open_user(b, 'alice', ALICE_LOOK)
    check(fa.evaluate('__island.net.avatars.count') == 0, 'alice 一個人時沒有其他化身')
    check(fa.evaluate('JSON.stringify(Object.values(__island.look))') == str(ALICE_LOOK).replace(' ', ''), 'alice 捏好的外觀已套用')
    saved = fa.evaluate("localStorage.getItem('pie-island.look.v1')")
    check(saved == str(ALICE_LOOK).replace(' ', ''), f'外觀有存起來：{saved}')
    fa.evaluate('__island.setPose(0, 16, Math.PI)')

    pb, fb = open_user(b, 'bob', BOB_LOOK)
    fb.evaluate('__island.setPose(1.5, 14, Math.PI)')
    fa.wait_for_function('__island.net.avatars.count === 1', timeout=30000)
    fb.wait_for_function('__island.net.avatars.count === 1', timeout=30000)
    check(True, '兩邊都看得到對方（各 1 個化身）')
    fa.wait_for_function("document.getElementById('online').textContent.includes('2 人')", timeout=10000)
    check(True, 'HUD 顯示島上 2 人')

    fa.wait_for_function('__island.net.avatars.positions()[0].lookKnown', timeout=30000)
    fb.wait_for_function('__island.net.avatars.positions()[0].lookKnown', timeout=30000)
    a_sees = fa.evaluate('Object.values(__island.net.avatars.positions()[0].look)')
    b_sees = fb.evaluate('Object.values(__island.net.avatars.positions()[0].look)')
    check(a_sees == BOB_LOOK, f'alice 看到 bob 的臉：{a_sees}')
    check(b_sees == ALICE_LOOK, f'bob 看到 alice 的臉：{b_sees}')
    check(fa.evaluate('__island.net.avatars.positions()[0].name') == 'BOB', '名牌是顯示名稱')

    fa.wait_for_function("(() => { const q = __island.net.avatars.positions()[0]; return q.visible && Math.abs(q.x - 1.5) < 0.3 && Math.abs(q.z - 14) < 0.3; })()", timeout=30000)
    check(True, 'alice 看到 bob 站在 (1.5, 14)')

    # bob 真的用鍵盤走路，alice 這邊跟著動
    fb.locator('body').press('KeyD')
    before = fb.evaluate('__island.state')
    fb.locator('body').evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))")
    fb.wait_for_timeout(1500)
    fb.locator('body').evaluate("() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))")
    after = fb.evaluate('__island.state')
    moved = ((after['x'] - before['x']) ** 2 + (after['z'] - before['z']) ** 2) ** 0.5
    check(moved > 1.5, f'bob 按 W 走了 {moved:.1f} m')
    fa.wait_for_function(f"(() => {{ const q = __island.net.avatars.positions()[0]; return Math.hypot(q.x - {after['x']}, q.z - {after['z']}) < 0.4; }})()", timeout=30000)
    check(True, 'bob 走路後 alice 這邊位置同步')

    # 表情
    fb.evaluate("__island.emote('wave')")
    fa.wait_for_function("__island.net.avatars.positions()[0].emote === 'wave'", timeout=10000)
    check(True, 'bob 揮手，alice 看到表情')

    # 改臉：即時更新到對方
    new_look = list(BOB_LOOK); new_look[7] = 7; new_look[16] = 5
    fb.evaluate('l => __island.setLook(l)', new_look)
    fa.wait_for_function(f"JSON.stringify(Object.values(__island.net.avatars.positions()[0].look)) === '{str(new_look).replace(' ', '')}'", timeout=10000)
    check(True, 'bob 改臉後 alice 看到新造型')

    # 截圖：alice 的鏡頭對著 bob
    fb.evaluate('__island.setPose(0, 13, 0)')
    fa.evaluate('__island.setPose(-1.2, 13.2, 0.5); __island.setCamera(0.25, 0.32, 6.5)')
    fb.evaluate("__island.emote('love')")
    fa.wait_for_timeout(1500)
    pa.screenshot(path=out / 'alice-sees-bob.png')

    pb.close()
    fa.wait_for_function('__island.net.avatars.count === 0', timeout=30000)
    check(True, 'bob 離開後化身移除')

    # 第三位加入同一間房
    pc, fc = open_user(b, 'carol', ALICE_LOOK)
    fa.wait_for_function('__island.net.avatars.count === 1', timeout=30000)
    fc.wait_for_function('__island.net.avatars.count === 1', timeout=30000)
    check(True, 'carol 加入同一間房，與 alice 互見')

    # 單機退路：不在外框裡
    ps = b.new_page(viewport={'width': 640, 'height': 400})
    ps.on('pageerror', lambda e: errors.append(f'solo: {e}'))
    ps.goto(BASE + '/games/community/pie-island/index.html?x=1' + Q)
    ps.wait_for_function('window.__island && window.__island.world', timeout=240000)
    ps.wait_for_function("document.getElementById('online').textContent.length > 0", timeout=20000)
    check(ps.evaluate("document.getElementById('online').dataset.mode") == 'solo', '未登入退回單機')
    check(ps.evaluate("document.getElementById('start').disabled") is False, '單機仍可登島')
    b.close()

runtime_errors = [e for e in errors if 'favicon' not in e]
check(not runtime_errors, f'瀏覽器無執行錯誤：{runtime_errors[:8]}')
print('FAILED' if fails else 'ALL PASS')
sys.exit(1 if fails else 0)
