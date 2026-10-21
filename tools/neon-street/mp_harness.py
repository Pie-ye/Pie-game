#!/usr/bin/env python3
"""本機多人測試台：靜態伺服器 + 真的 server.relay.Relay（/mp）+ 假外框頁。

用法：python3 tools/neon-street/mp_harness.py [--port 18772]
開 http://127.0.0.1:18772/fake-shell.html?u=alice 與 ?u=bob 就是兩個「登入使用者」，各自在 iframe 裡跑遊戲。
票證假的：ticket 就是 "t-<user>"，不經過股票大亂鬥的 retire 服務。
"""
import sys
from pathlib import Path

from aiohttp import web

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from server.relay import Relay  # noqa: E402

PORT = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 18772
GAME = 'neon-arcade-street'

SHELL = """<!doctype html><meta charset=utf-8><title>fake shell</title>
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
<iframe id=g></iframe>
<script>
const u = new URLSearchParams(location.search).get('u') || 'guest';
const q = new URLSearchParams(location.search).get('q') || '';
const f = document.getElementById('g');
f.src = '/games/community/@GAME@/index.html?autoq=0' + q;
let n = 0;
addEventListener('message', (e) => {
  if (e.source !== f.contentWindow) return;
  const d = e.data || {};
  if (d.type === 'pg:ready') f.contentWindow.postMessage({ type: 'pg:init', gameId: '@GAME@', user: { id: u, username: u, displayName: u.toUpperCase() }, ticket: 't-' + u + '-' + (n++) }, '*');
  else if (d.type === 'pg:ticket') f.contentWindow.postMessage({ type: 'pg:ticket', ticket: 't-' + u + '-' + (n++) }, '*');
});
</script>""".replace('@GAME@', GAME)


def redeem(ticket):
    user = ticket.split('-')[1]
    return dict(gameId=GAME, userId=user, username=user, displayName=user.upper())


def main():
    relay = Relay(f'http://127.0.0.1:{PORT}', redeem=redeem)
    app = web.Application()
    app.router.add_get('/mp', relay.websocket_handler)
    app.router.add_get('/fake-shell.html', lambda r: web.Response(text=SHELL, content_type='text/html'))
    app.router.add_static('/', ROOT / 'site', show_index=False)
    web.run_app(app, host='127.0.0.1', port=PORT, print=lambda *_: None)


if __name__ == '__main__':
    main()
