#!/usr/bin/env python3
"""星光電玩街截圖與行為檢查（無頭 Chromium + 軟體 WebGL）。

用法：先起靜態伺服器  python3 -m http.server 18770 --bind 127.0.0.1 --directory site
      python3 tools/neon-street/shots.py <輸出資料夾> [--w 1280 --h 720]
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
W = int(sys.argv[sys.argv.index('--w') + 1]) if '--w' in sys.argv else 1280
H = int(sys.argv[sys.argv.index('--h') + 1]) if '--h' in sys.argv else 720
import os
URL = 'http://127.0.0.1:18770/games/community/neon-arcade-street/index.html?autoq=0&autostart=1' + os.environ.get('NS_Q', '')
POSES = {  # 名稱: (x, z, yaw, pitch)  yaw=0 朝北(-z)；yaw=π/2 朝西；-π/2 朝東
    'spawn': (0, 16, 0, 0.02),
    'plaza_e': (0, 8, -1.571, 0.05),
    'plaza_s': (0, -10, 3.14159, 0.05),
    'north': (0, -26, 0, 0.05),
    'east': (30, 0, -1.571, 0.05),
    'south': (0, 30, 3.14159, 0.05),
    'west': (-30, 0, 1.571, 0.05),
    'look_up': (0, 16, 0, 0.9),
    'ave_n_deep': (0, -60, 0, 0.1),
}
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'])
    page = b.new_page(viewport={'width': W, 'height': H})
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    page.goto(URL)
    page.wait_for_function('window.__street && window.__street.world', timeout=120000)
    page.wait_for_timeout(1500)
    for name, (x, z, yaw, pitch) in POSES.items():
        if len(sys.argv) > 2 and sys.argv[2] not in ('--w', '--h') and name not in sys.argv[2].split(','):
            continue
        page.evaluate(f'window.__street.setPose({x},{z},{yaw},{pitch})')
        page.wait_for_timeout(1800)
        page.screenshot(path=out / f'{name}.png')
        print(name, page.evaluate('window.__street.fps'), page.evaluate('JSON.stringify(window.__street.stats())'))
    b.close()
print('errors:', errors[:12])
