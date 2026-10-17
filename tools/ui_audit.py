#!/usr/bin/env python3
"""可重複執行的機械式檢查（不靠人或模型判斷）：舊介面程式碼是否清除、每款遊戲是否真的載入自己的皮膚。
需要 server.app --dev 與 tools/dev_stub_api.py 在跑。任何一項不符就以非零碼結束。"""
import re, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
fail = []

# 1. 舊檔案已刪、舊識別字已清
for rel in ('shell.css', 'tokens.css', 'casino-skin.css', 'hud.css', 'casino'):
    if (ROOT / 'site/shell' / rel).exists(): fail.append(f'old file still exists: {rel}')
OLD = re.compile(r'casino-skin|themeSelect|data-theme|notifyTheme|applyTheme|onTheme|pg:theme|lobby-section|game-card|tokens\.css|shell\.css')
for path in list((ROOT / 'site').rglob('*')):
    if path.suffix not in ('.js', '.css', '.html') or not path.is_file(): continue
    rel = path.relative_to(ROOT).as_posix()
    if '/vendor/' in rel or '/tests/' in rel or 'model-preview' in rel or 'rig-preview' in rel: continue
    if OLD.search(path.read_text(encoding='utf-8', errors='ignore')): fail.append(f'old identifier in {rel}')
if (ROOT / 'site/shell/ui/games').is_dir() is False: fail.append('ui/games missing')

# 2. 每款遊戲真的載入自己的皮膚、強調色互不相同
IDS = ['slots', 'blackjack', 'baccarat', 'niuniu', 'dragon', 'texas-holdem', 'coin-flip', 'lucky-wheel',
       'pie-phoebe', 'phoebe-egg', 'phoebe-peak', 'snake', 'tic-tac-toe']
BASE = 'http://localhost:54470/?api=http://127.0.0.1:54480&content=http://127.0.0.1:54471'
seen = {}
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={'width': 1280, 'height': 800})
    for i in IDS:
        if not (ROOT / f'site/shell/ui/games/{i}.css').exists(): fail.append(f'{i}: no skin css')
        page.goto(BASE + '#/game/' + i); page.wait_for_selector(f'.gx-{i}', timeout=8000); page.wait_for_timeout(600)
        info = page.evaluate("""(id) => { const gx = document.querySelector('.gx'); const cs = getComputedStyle(gx);
          return {cls: gx.className, accent: cs.getPropertyValue('--gx-accent').trim(), base: cs.getPropertyValue('--gx-base').trim(),
                  sheets: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).filter(h => h.includes('/ui/games/' + id + '.css')).length,
                  oldTheme: document.documentElement.hasAttribute('data-theme'), themeSel: !!document.getElementById('themeSelect')}; }""", i)
        if info['sheets'] != 1: fail.append(f'{i}: skin stylesheet not loaded ({info["sheets"]})')
        if info['oldTheme'] or info['themeSel']: fail.append(f'{i}: old theme present')
        seen[i] = (info['accent'], info['base'])
    # 3. 登入畫面是新的街機畫面
    page.goto(BASE + '#/login'); page.wait_for_selector('.lg-cab')
    if page.locator('#loginForm').count() != 1 or page.locator('.lg-hero').count() != 1: fail.append('login scene incomplete')
    b.close()
accents = {}
for i, (a, base) in seen.items(): accents.setdefault((a, base), []).append(i)
for key, ids in accents.items():
    if len(ids) > 1: fail.append(f'identical palette: {ids}')
for i, v in seen.items(): print(f'{i:14s} accent={v[0]:9s} base={v[1]}')
print('FAIL' if fail else 'OK', *fail, sep='\n  ' if fail else ' ')
sys.exit(1 if fail else 0)
