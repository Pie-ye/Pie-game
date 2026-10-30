#!/usr/bin/env python3
"""雲端存檔端到端測試：真的開發伺服器（多人轉送＋SQLite）＋真的 SDK＋假外框＋假通行證兌換。

兩個瀏覽器環境（各自獨立的 localStorage）當成兩台裝置登入同一個帳號，確認：
  1. 裝置 A 的農場、外觀上傳後，全新的裝置 B 會載入（也不會再跳捏臉）
  2. 兩台同時修改：較新的版本留下，伺服器有版本號
  3. 另一個帳號看不到
用法：python3 tools/pie-plaza/cloud_e2e.py
"""
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
fails = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


NAMES = {"u1": "阿派", "u2": "小菲"}


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


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    db = tmp / "saves.sqlite3"
    rport, sport, cport = free_port(), free_port(), free_port()
    shell, content = f"http://127.0.0.1:{sport}", f"http://127.0.0.1:{cport}"
    redeem = ThreadingHTTPServer(("127.0.0.1", rport), Redeem)
    threading.Thread(target=redeem.serve_forever, daemon=True).start()
    # 假外框要佔用「外框 origin」：伺服器自己的外框埠改用另一個沒用到的埠
    parent = ThreadingHTTPServer(("127.0.0.1", sport), parent_handler(content))
    threading.Thread(target=parent.serve_forever, daemon=True).start()
    env = {**os.environ, "PG_SHELL_PORT": str(free_port()), "PG_CONTENT_PORT": str(cport), "PG_SHELL_ORIGIN": shell,
           "PG_CONTENT_ORIGIN": content, "PG_RETIRE_BASE": f"http://127.0.0.1:{rport}", "PG_SAVE_DB": str(db)}
    srv = subprocess.Popen([sys.executable, "-m", "server.app", "--dev"], cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cport), timeout=0.2).close(); break
            except OSError:
                time.sleep(0.1)
        with sync_playwright() as pw:
            b = pw.chromium.launch()

            def device(uid):
                ctx = b.new_context(viewport={"width": 1300, "height": 800})
                pg = ctx.new_page()
                errs = []
                pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                pg.goto(f"{shell}/?u={uid}")
                fr = pg.frame_locator("#g")
                frame = pg.frames[1] if len(pg.frames) > 1 else None
                for _ in range(100):
                    frame = next((f for f in pg.frames if "pie-plaza" in f.url), None)
                    if frame: break
                    pg.wait_for_timeout(100)
                frame.wait_for_function("window.__plaza && window.__plaza.cloud && /已同步|等待|同步中/.test(document.getElementById('cloud').textContent)", timeout=20000)
                return ctx, pg, frame, errs

            P = "window.__plaza"
            # 裝置 A：第一次登入 → 捏臉 → 改農場
            ctxA, pgA, A, errsA = device("u1")
            check(A.is_visible(".creator"), "A：新帳號第一次登入要捏臉")
            A.locator(".creator-faces button").nth(7).click()
            A.locator(".swatches").nth(0).locator("button").nth(4).click()
            A.locator(".creator .primary").click()
            A.evaluate(f"(() => {{ const f = {P}.farm; f.gold = 777; f.inv.wheat = 3; delete f.debris[Object.keys(f.debris)[0]]; {P}.touch(); }})()")
            A.wait_for_function("document.getElementById('cloud').textContent.includes('已同步')", timeout=15000)
            check("已同步" in A.inner_text("#cloud"), "A：上傳後顯示已同步")
            debrisA = A.evaluate(f"Object.keys({P}.farm.debris).length")
            con = sqlite3.connect(db)
            rows = dict(con.execute("SELECT key, rev FROM saves WHERE game_id='pie-plaza' AND user_id='u1'").fetchall())
            check({"farm", "look", "decor"} <= set(rows), f"伺服器存了 farm、look、decor {rows}")

            # 裝置 B：全新瀏覽器、同一個帳號
            ctxB, pgB, B, errsB = device("u1")
            B.wait_for_timeout(500)
            check(B.evaluate(f"{P}.farm.gold") == 777 and B.evaluate(f"{P}.farm.inv.wheat") == 3, "B：載入 A 的金幣與背包")
            check(B.evaluate(f"Object.keys({P}.farm.debris).length") == debrisA, "B：清掉的雜物也同步")
            check(not B.is_visible(".creator") and B.evaluate(f"{P}.me.look")[0] == 7, "B：沿用雲端外觀，不再跳捏臉")
            check("雲端" in B.inner_text("#log"), "B：聊天室提示已從雲端載入")

            # 兩台先後修改：B 改 888，接著 A（拿著舊版本號）改 999 → A 衝突後較新者勝
            B.evaluate(f"(() => {{ {P}.farm.gold = 888; {P}.touch(); }})()")
            B.wait_for_function("document.getElementById('cloud').textContent.includes('已同步')", timeout=15000)
            B.wait_for_timeout(300)
            A.evaluate(f"(() => {{ {P}.farm.gold = 999; {P}.touch(); }})()")
            A.wait_for_timeout(4500)
            A.wait_for_function("document.getElementById('cloud').textContent.includes('已同步')", timeout=15000)
            farm = json.loads(con.execute("SELECT value FROM saves WHERE user_id='u1' AND key='farm'").fetchone()[0])
            rev = con.execute("SELECT rev FROM saves WHERE user_id='u1' AND key='farm'").fetchone()[0]
            check(farm["gold"] == 999 and rev >= 3, f"同時修改：較新的 999 留下（rev {rev}）")
            ctxC, pgC, C, _ = device("u1")
            C.wait_for_timeout(500)
            check(C.evaluate(f"{P}.farm.gold") == 999, "第三台裝置看到最新的 999")

            # 別的帳號看不到
            ctxD, pgD, D, _ = device("u2")
            check(D.evaluate(f"{P}.farm.gold") == 100 and D.is_visible(".creator"), "u2 是全新的農場，看不到 u1 的資料")
            pgB.screenshot(path=str(tmp / "deviceB.png"))
            check(not [e for e in errsA + errsB if "favicon" not in e], f"console 無錯誤 {errsA[:2] + errsB[:2]}")
            b.close()
    finally:
        srv.terminate()
        try:
            out = srv.communicate(timeout=5)[0].decode(errors="replace")
        except subprocess.TimeoutExpired:
            srv.kill(); out = ""
        redeem.shutdown(); parent.shutdown()
        if fails:
            print("--- server log ---\n" + out[-2000:])
    print(f"暫存目錄：{tmp}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
