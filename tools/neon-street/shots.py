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
    'ground_e': (24, 2, -1.571, -0.55),
    'facade_up': (40, 4, 0, 0.7),
    'wall_close': (40, 7.5, 0, 0.2),
    'plaza_floor': (6, 6, -2.4, -0.6),
    'p_hydrant': (3.2, -46.8, -1.571, -0.2),
    'p_trash': (5.6, -61.9, -1.571, -0.15),
    'p_aircon': (4.0, -47.8, -1.571, 0.28),
    'p_alley': (-6.5, -82.5, 1.571, -0.1),
    'p_barrier': (0.5, -63, 1.9, -0.12),
    'p_aircon2': (-3.5, -34.5, 1.571, 0.62),
    'p_alley2': (-11.0, -83.8, 1.571, -0.05),
    'p_alley3': (-15.5, -83.8, -1.571, 0.0),
    'p_ccar': (0.5, -70.5, 0.35, -0.05),
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
