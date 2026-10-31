"""端到端測試環境：真的開發伺服器（多人轉送＋SQLite＋派派鎮伺服器邏輯）＋假外框＋假通行證兌換。

用法：
    with E2E() as env:
        page, frame = env.device("u1")
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
NAMES = {"u1": "阿派", "u2": "小菲", "u3": "阿明"}


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class Redeem(BaseHTTPRequestHandler):
    """假的股票大亂鬥通行證兌換：ticket 格式 <userId>:<gameId>:<序號>。"""
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        uid, game, _ = body["ticket"].split(":", 2)
        out = json.dumps({"userId": uid, "username": uid, "displayName": NAMES.get(uid, uid), "gameId": game}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

    def log_message(self, *a): pass


def parent_handler(content):
    class Parent(BaseHTTPRequestHandler):
        """假外框：iframe 載入遊戲，回答 pg:ready／pg:ticket。"""
        def do_GET(self):
            uid = self.path.split("u=")[-1] if "u=" in self.path else "u1"
            html = f"""<!doctype html><meta charset=utf-8><body style=margin:0>
<iframe id=g src="{content}/games/community/pie-plaza/index.html" style="width:1280px;height:760px;border:0" sandbox="allow-scripts allow-same-origin"></iframe>
<script>
let n = 0; const user = {{ id: {json.dumps(uid)}, username: {json.dumps(uid)}, displayName: {json.dumps(NAMES.get(uid, uid))} }};
const ticket = () => user.id + ':pie-plaza:' + (++n);
addEventListener('message', (e) => {{
  const f = document.getElementById('g').contentWindow;
  if (e.source !== f) return;
  if (e.data.type === 'pg:ready') f.postMessage({{ type: 'pg:init', gameId: 'pie-plaza', user, ticket: ticket() }}, '{content}');
  if (e.data.type === 'pg:ticket') f.postMessage({{ type: 'pg:ticket', ticket: ticket() }}, '{content}');
}});
</script>""".encode()
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(html))); self.end_headers(); self.wfile.write(html)

        def log_message(self, *a): pass
    return Parent


class E2E:
    def __init__(self, env=None):
        self.extra_env = dict(env or {})
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "saves.sqlite3"

    def __enter__(self):
        rport, sport, self.cport = free_port(), free_port(), free_port()
        self.shell, self.content = f"http://127.0.0.1:{sport}", f"http://127.0.0.1:{self.cport}"
        self.redeem = ThreadingHTTPServer(("127.0.0.1", rport), Redeem)
        self.parent = ThreadingHTTPServer(("127.0.0.1", sport), parent_handler(self.content))
        for s in (self.redeem, self.parent):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        env = {**os.environ, "PG_SHELL_PORT": str(free_port()), "PG_CONTENT_PORT": str(self.cport), "PG_SHELL_ORIGIN": self.shell,
               "PG_CONTENT_ORIGIN": self.content, "PG_RETIRE_BASE": f"http://127.0.0.1:{rport}", "PG_SAVE_DB": str(self.db), **self.extra_env}
        self.srv = subprocess.Popen([sys.executable, "-m", "server.app", "--dev"], cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for _ in range(80):
            try:
                socket.create_connection(("127.0.0.1", self.cport), timeout=0.2).close(); break
            except OSError:
                time.sleep(0.1)
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch()
        self.errors = []
        return self

    def device(self, uid, look=None):
        """一個獨立的瀏覽器（各自的 localStorage）登入 uid；回傳 (page, frame)。look 有給就預先存好、跳過捏臉。"""
        ctx = self.browser.new_context(viewport={"width": 1300, "height": 800})
        page = ctx.new_page()
        page.on("console", lambda m: self.errors.append(f"{uid}: {m.text}") if m.type == "error" else None)
        page.goto(f"{self.shell}/?u={uid}")
        frame = None
        for _ in range(100):
            frame = next((f for f in page.frames if "pie-plaza" in f.url), None)
            if frame: break
            page.wait_for_timeout(100)
        frame.wait_for_function("window.__plaza && window.__plaza.ready && window.__plaza.server", timeout=20000)
        if look is not None and frame.is_visible(".creator"):
            frame.evaluate(f"window.__plaza.call('look', {{ look: {json.dumps(look)} }})")
            frame.locator(".creator .primary").click()
        return page, frame

    def key(self, page, frame, k):
        frame.evaluate("window.focus()"); page.keyboard.press(k)

    def __exit__(self, *exc):
        self.browser.close(); self.pw.stop()
        self.srv.terminate()
        try:
            self.log = self.srv.communicate(timeout=5)[0].decode(errors="replace")
        except subprocess.TimeoutExpired:
            self.srv.kill(); self.log = ""
        self.redeem.shutdown(); self.parent.shutdown()
        return False
