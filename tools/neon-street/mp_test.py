#!/usr/bin/env python3
"""霓虹電玩街多人連線測試：兩個「使用者」各開一個外框頁，互相要看得到對方。

先起測試台：python3 tools/neon-street/mp_harness.py   （port 18772）
用法：python3 tools/neon-street/mp_test.py [輸出截圖資料夾]
"""
import sys
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/ns-mp'); out.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('ARCADE_TEST_ORIGIN', 'http://127.0.0.1:18772')
Q = '&bloom=0&rain=0&lights=2&fps=20'
errors, fails = [], []


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)


def game_frame(page):
    page.wait_for_selector('iframe')
    for _ in range(100):
        for f in page.frames:
            if 'neon-arcade-street' in f.url:
                return f
        page.wait_for_timeout(100)
    raise RuntimeError('no game frame')


def open_user(browser, name, q=Q):
    page = browser.new_page(viewport={'width': 560, 'height': 315})
    page.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
    page.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' else None)
    page.goto(f'{BASE}/fake-shell.html?u={name}&q={q}')
    fr = game_frame(page)
    fr.wait_for_function("window.__street && window.__street.world && window.__street.mode !== 'loading'", timeout=180000)
    return page, fr


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'])
    pa, fa = open_user(b, 'alice')
    fa.wait_for_function("__street.net.status.mode === 'online'", timeout=30000)
    check(True, 'alice 連上並進房')
    check(fa.evaluate('__street.net.avatars.count') == 0, '只有 alice 時沒有其他化身')
    fa.evaluate('__street.setPose(0, 16, 0, 0.02)')

    pb, fb = open_user(b, 'bob')
    fb.wait_for_function("__street.net.status.mode === 'online'", timeout=30000)
    fb.evaluate('__street.setPose(0, 9, 0, 0.02)')
    fa.wait_for_function('__street.net.avatars.count === 1', timeout=30000)
    fb.wait_for_function('__street.net.avatars.count === 1', timeout=30000)
    check(True, '兩邊都看得到對方（各 1 個化身）')
    check(fa.evaluate("document.getElementById('online').textContent") == '● 線上 2 人', 'HUD 顯示線上 2 人')

    fa.wait_for_function("(() => { const q = __street.net.avatars.positions()[0]; return q && q.visible && Math.abs(q.z - 9) < 0.3; })()", timeout=30000)
    pos = fa.evaluate('__street.net.avatars.positions()[0]')
    check(pos['name'] == 'BOB', f'名牌是顯示名稱：{pos["name"]}')
    check(abs(pos['x']) < 0.3 and abs(pos['z'] - 9) < 0.3, f'alice 看到 bob 在 ({pos["x"]:.1f}, {pos["z"]:.1f})')

    fb.evaluate('__street.setPose(14, -6, 1.2, 0)')
    fa.wait_for_function("(() => { const q = __street.net.avatars.positions()[0]; return q && Math.abs(q.x - 14) < 0.4 && Math.abs(q.z + 6) < 0.4; })()", timeout=30000)
    check(True, 'bob 走到別處，alice 這邊跟著更新')

    fb.evaluate('__street.setPose(0, 9, 0, 0.02)')
    fa.wait_for_function("(() => { const q = __street.net.avatars.positions()[0]; return q && Math.abs(q.x) < 0.4 && Math.abs(q.z - 9) < 0.4; })()", timeout=30000)
    fa.wait_for_timeout(1200)
    pa.screenshot(path=out / 'alice_page.png')

    # Different areas hide peers; the shared arcade reveals indoor peers again.
    fa.locator('#start').click()
    fa.wait_for_function("__street.mode === 'play'")
    fa.evaluate('__street.setPose(10.45, 49.1)')
    fa.locator('body').press('KeyE')
    fa.wait_for_function('__street.interior')
    fa.wait_for_function('__street.net.avatars.positions().every(p => !p.visible)')
    fb.wait_for_function('__street.net.avatars.positions().every(p => !p.visible)')
    check(True, '街上與室內玩家互相隱藏')
    fb.locator('#start').click()
    fb.wait_for_function("__street.mode === 'play'")
    fb.evaluate('__street.setPose(10.45, 49.1)')
    fb.locator('body').press('KeyE')
    fb.wait_for_function('__street.interior')
    fa.wait_for_function('__street.net.avatars.positions().some(p => p.visible && p.z < -230)')
    fb.wait_for_function('__street.net.avatars.positions().some(p => p.visible && p.z < -230)')
    check(True, '兩人進入同一電玩屋後互見，沒有跨區插值飛行')

    pb.close()
    fa.wait_for_function('__street.net.avatars.count === 0', timeout=30000)
    check(True, 'bob 離開後，alice 的化身移除')
    check(fa.evaluate("document.getElementById('online').textContent") == '● 線上 1 人', 'HUD 回到線上 1 人')

    # 第三位加入：應進同一間
    pc, fc = open_user(b, 'carol')
    fc.wait_for_function("__street.net.status.mode === 'online'", timeout=30000)
    fa.wait_for_function('__street.net.avatars.count === 1', timeout=30000)
    fc.wait_for_function('__street.net.avatars.count === 1', timeout=30000)
    check(True, 'carol 加入同一間房，與 alice 互見')

    # 單機退路：不在外框裡（獨立模式）、不登入
    ps = b.new_page(viewport={'width': 480, 'height': 270})
    ps.on('pageerror', lambda e: errors.append(f'solo: {e}'))
    ps.goto(BASE + '/games/community/neon-arcade-street/index.html?autoq=0' + Q)
    ps.wait_for_function('window.__street && window.__street.mode === "title"', timeout=180000)
    ps.wait_for_function("document.getElementById('online').textContent.length > 0", timeout=20000)
    check(ps.evaluate("document.getElementById('online').dataset.mode") == 'solo', '未登入退回單機')
    check(ps.evaluate("document.getElementById('start').disabled") is False, '單機模式仍可進入遊戲')
    b.close()

runtime_errors = [e for e in errors if 'favicon' not in e]
check(not runtime_errors, f'瀏覽器無執行錯誤：{runtime_errors[:8]}')
print('FAILED' if fails else 'ALL PASS')
sys.exit(1 if fails else 0)
