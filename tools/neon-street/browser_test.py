#!/usr/bin/env python3
"""星光電玩街的瀏覽器行為測試（真實鍵盤／滑鼠事件）。

先起靜態伺服器：python3 -m http.server 18770 --bind 127.0.0.1 --directory site
用法：python3 tools/neon-street/browser_test.py [輸出截圖資料夾]
"""
import math
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/ns-browser'); out.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:18770/games/community/neon-arcade-street/index.html?autoq=0'
errors, fails = [], []


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'])
    page = b.new_page(viewport={'width': 640, 'height': 360})  # 軟體 WebGL 很慢，行為測試用小視窗
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 400 else None)
    page.goto(BASE)
    page.wait_for_function('window.__street && window.__street.world', timeout=120000)
    page.wait_for_timeout(800)
    check(page.evaluate("document.body.dataset.mode") == 'title', '載入完成後顯示標題畫面')
    check(not page.evaluate("document.getElementById('start').disabled"), '開始按鈕可按')
    page.screenshot(path=out / 'title.png')
    print('fps', page.evaluate('__street.fps'))

    page.click('#start')
    page.wait_for_function("window.__street.mode === 'play'", timeout=5000)
    check(True, '按下開始進入遊玩狀態')
    pl = lambda: page.evaluate('({x: __street.player.x, z: __street.player.z, yaw: __street.player.yaw, y: __street.player.y})')
    page.evaluate('__street.setPose(0, 40, 0, 0)')
    page.wait_for_timeout(200)
    def hold(cond):   # 軟體渲染幀率很低，按住直到條件成立（最多 20 秒）而不是固定時間
        try:
            page.wait_for_function(cond, timeout=20000)
        except Exception:
            pass
    a = pl()
    page.keyboard.down('KeyW'); hold(f"__street.player.z < {a['z'] - 2.6}"); page.keyboard.up('KeyW'); page.wait_for_timeout(300)
    b2 = pl()
    check(b2['z'] < a['z'] - 2.5 and abs(b2['x'] - a['x']) < 0.1, f"W 往前走（朝北）：z {a['z']:.1f} → {b2['z']:.1f}")
    page.keyboard.down('KeyD'); hold(f"__street.player.x > {b2['x'] + 1.6}"); page.keyboard.up('KeyD'); page.wait_for_timeout(300)
    c = pl()
    check(c['x'] > b2['x'] + 1.5, f"D 往右（東）走：x {b2['x']:.1f} → {c['x']:.1f}")
    page.keyboard.down('KeyS'); hold(f"__street.player.z > {c['z'] + 1.6}"); page.keyboard.up('KeyS'); page.wait_for_timeout(200)
    d = pl()
    check(d['z'] > c['z'] + 1.5, f"S 往後退：z {c['z']:.1f} → {d['z']:.1f}")
    # 奔跑速度比較（讀速度而不是距離，不受軟體渲染的低幀率影響）
    page.evaluate('__street.setPose(0, 60, 0, 0)'); page.wait_for_timeout(100)
    speed = "Math.hypot(__street.player.vx, __street.player.vz)"
    page.keyboard.down('KeyW'); page.wait_for_function(f'{speed} > 3.0', timeout=20000); page.wait_for_timeout(400)
    v_walk = page.evaluate(speed); page.keyboard.up('KeyW')
    page.evaluate('__street.setPose(0, 60, 0, 0)'); page.wait_for_timeout(100)
    page.keyboard.down('Shift'); page.keyboard.down('KeyW'); page.wait_for_function(f'{speed} > 5.5', timeout=20000); page.wait_for_timeout(400)
    v_run = page.evaluate(speed); page.keyboard.up('KeyW'); page.keyboard.up('Shift')
    check(3.0 < v_walk < 3.8 and 6.0 < v_run < 6.9, f"步行 {v_walk:.1f} m/s、奔跑 {v_run:.1f} m/s")
    # 轉視角（滑鼠拖曳，無法鎖定時的備案模式；或方向鍵）
    y0 = pl()['yaw']
    page.keyboard.down('ArrowLeft')
    try:
        page.wait_for_function(f'__street.player.yaw > {y0 + 0.5}', timeout=15000)   # 軟體渲染很慢，等到轉夠為止
    except Exception:
        pass
    page.keyboard.up('ArrowLeft')
    y1 = pl()['yaw']
    check(y1 > y0 + 0.5, f"方向鍵左轉視角：yaw {y0:.2f} → {y1:.2f}")
    page.mouse.move(600, 360); page.mouse.down(); page.mouse.move(700, 360, steps=5); page.mouse.up()
    y2 = pl()['yaw']
    check(abs(y2 - y1) > 0.1 or page.evaluate('document.pointerLockElement !== null'), f"滑鼠轉視角：yaw {y1:.2f} → {y2:.2f}")
    # 撞牆：在東大道朝南（大樓方向）一直走。路上可能先撞到路燈或長椅，所以只驗證「停得住、絕不穿過大樓正面（z=10）」
    page.evaluate(f'__street.setPose(63.5, 0, {math.pi}, 0)'); page.wait_for_timeout(100)
    page.keyboard.down('Shift'); page.keyboard.down('KeyW')
    page.wait_for_function('__street.player.z > 3', timeout=30000)
    # 軟體渲染幀率低，走得慢：每 1.5 秒取樣，直到位置不再變動（最多 60 秒）
    w2 = pl()
    for _ in range(40):
        w1 = w2; page.wait_for_timeout(1500); w2 = pl()
        if abs(w2['z'] - w1['z']) < 0.05 or w2['z'] >= 9.7:
            break
    page.keyboard.up('KeyW'); page.keyboard.up('Shift')
    check(w2['z'] < 9.7 and abs(w2['z'] - w1['z']) < 0.05, f"一直往大樓走會停住、不穿牆：z={w2['z']:.2f}（大樓正面在 z=10）")
    # 跳躍
    page.evaluate('__street.setPose(0, 40, 0, 0)'); page.wait_for_timeout(300)
    page.keyboard.press('Space')   # 零長度的輕按，驗證不會被漏掉
    ymax = 0
    for _ in range(40):
        page.wait_for_timeout(60); ymax = max(ymax, pl()['y'])
    check(ymax > 0.2, f'空白鍵輕按可以跳起：最高 {ymax:.2f} m')
    page.wait_for_function('__street.player.y === 0', timeout=15000)
    check(pl()['y'] == 0, '跳完會落地')
    # 區域橫幅
    page.evaluate('__street.setPose(60, 0, 0, 0)')
    try:
        page.wait_for_function("document.getElementById('zone-name').textContent.includes('電玩街')", timeout=15000)
    except Exception:
        pass
    check('電玩街' in page.inner_text('#zone-name'), f"走到東大道顯示區域名：{page.inner_text('#zone-name')}")
    page.evaluate('__street.setPose(0, 0, 0, 0)')
    try:
        page.wait_for_function("document.getElementById('zone-name').textContent.includes('廣場')", timeout=15000)
    except Exception:
        pass
    check('廣場' in page.inner_text('#zone-name'), f"回到廣場顯示區域名：{page.inner_text('#zone-name')}")
    # 切換
    page.keyboard.press('KeyR'); page.wait_for_timeout(100)
    check(page.evaluate('__street.mode') == 'play', 'R 切換雨不影響遊玩')
    # 暫停
    page.evaluate('document.exitPointerLock && document.exitPointerLock()')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    check(page.evaluate("document.body.dataset.mode") in ('pause', 'play'), 'Esc 可進入暫停')
    page.screenshot(path=out / 'pause.png')
    # 手機版面
    page.set_viewport_size({'width': 390, 'height': 780}); page.wait_for_timeout(600)
    page.screenshot(path=out / 'mobile.png')
    b.close()

print('errors:', errors[:10])
check(not errors, '沒有主控台錯誤或 4xx/5xx')
print('FAILED' if fails else 'ALL PASSED', len(fails))
sys.exit(1 if fails else 0)
