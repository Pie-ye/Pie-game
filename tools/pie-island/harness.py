#!/usr/bin/env python3
"""小島樂園本機測試台：靜態伺服器（套用線上內容 CSP）+ 真的 server.relay.Relay（/mp）+ 假外框頁。

用法：python3 tools/pie-island/harness.py [--port 18780]
開 http://127.0.0.1:18780/fake-shell.html?u=alice 與 ?u=bob 就是兩個「登入使用者」，各自在 iframe 裡跑遊戲。
不帶外框直接開 /games/community/pie-island/index.html 是未登入的單機模式。
票證是假的："t-<user>-<n>"，不經過股票大亂鬥。
"""
import sys
from pathlib import Path

from aiohttp import web

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from server.relay import Relay  # noqa: E402

PORT = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 18780
GAME = 'pie-island'
ORIGIN = f'http://127.0.0.1:{PORT}'
# 與 server/app.py 的 content_csp 相同（frame-ancestors 改成自己，因為假外框同源）
CSP = '; '.join((
    "default-src 'self' blob: data:",
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    f"connect-src 'self' ws://127.0.0.1:{PORT}",
    "frame-ancestors 'self'",
    "base-uri 'self'",
))

SHELL = """<!doctype html><meta charset=utf-8><title>fake shell</title>
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
<iframe id=g></iframe>
<script src="/fake-shell.js"></script>"""
SHELL_JS = """
const u = new URLSearchParams(location.search).get('u') || 'guest';
const q = new URLSearchParams(location.search).get('q') || '';
const f = document.getElementById('g');
f.src = '/games/community/@GAME@/index.html?x=1' + q;
let n = 0;
addEventListener('message', (e) => {
  if (e.source !== f.contentWindow) return;
  const d = e.data || {};
  if (d.type === 'pg:ready') f.contentWindow.postMessage({ type: 'pg:init', gameId: '@GAME@', user: { id: u, username: u, displayName: u.toUpperCase() }, ticket: 't-' + u + '-' + (n++) }, '*');
  else if (d.type === 'pg:ticket') f.contentWindow.postMessage({ type: 'pg:ticket', ticket: 't-' + u + '-' + (n++) }, '*');
});
""".replace('@GAME@', GAME)


def redeem(ticket):
    user = ticket.split('-')[1]
    return dict(gameId=GAME, userId=user, username=user, displayName=user.upper())


@web.middleware
async def csp(request, handler):
    resp = await handler(request)
    if request.path.startswith('/games/'):
        resp.headers['Content-Security-Policy'] = CSP
    return resp


def main():
    relay = Relay(ORIGIN, redeem=redeem)
    app = web.Application(middlewares=[csp])
    app.router.add_get('/mp', relay.websocket_handler)
    app.router.add_get('/fake-shell.html', lambda r: web.Response(text=SHELL, content_type='text/html'))
    app.router.add_get('/fake-shell.js', lambda r: web.Response(text=SHELL_JS, content_type='application/javascript'))
    app.router.add_static('/', ROOT / 'site', show_index=False)
    web.run_app(app, host='127.0.0.1', port=PORT, print=lambda *_: None)


if __name__ == '__main__':
    main()
