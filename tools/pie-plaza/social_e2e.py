#!/usr/bin/env python3
"""拜訪家園與社交的端到端測試：真的開發伺服器＋SQLite＋SDK，兩個帳號各用一個瀏覽器。

用法：python3 tools/pie-plaza/social_e2e.py [截圖目錄]
"""
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cloud_e2e import Redeem, parent_handler, free_port  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-social")
fails = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    rport, sport, cport = free_port(), free_port(), free_port()
    shell, content = f"http://127.0.0.1:{sport}", f"http://127.0.0.1:{cport}"
    redeem = ThreadingHTTPServer(("127.0.0.1", rport), Redeem)
    parent = ThreadingHTTPServer(("127.0.0.1", sport), parent_handler(content))
    for s in (redeem, parent):
        threading.Thread(target=s.serve_forever, daemon=True).start()
    env = {**os.environ, "PG_SHELL_PORT": str(free_port()), "PG_CONTENT_PORT": str(cport), "PG_SHELL_ORIGIN": shell,
           "PG_CONTENT_ORIGIN": content, "PG_RETIRE_BASE": f"http://127.0.0.1:{rport}", "PG_SAVE_DB": str(tmp / "s.sqlite3")}
    srv = subprocess.Popen([sys.executable, "-m", "server.app", "--dev"], cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    P = "window.__plaza"
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cport), timeout=0.2).close(); break
            except OSError:
                time.sleep(0.1)
        with sync_playwright() as pw:
            b = pw.chromium.launch()

            def device(uid, look):
                ctx = b.new_context(viewport={"width": 1300, "height": 800})
                ctx.add_init_script(f"if (location.port === '{cport}') localStorage.setItem('pie-plaza:look:{uid}', JSON.stringify({{l:{look}, at: 1}}));")
                pg = ctx.new_page(); errs = []
                pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                pg.goto(f"{shell}/?u={uid}")
                frame = None
                for _ in range(100):
                    frame = next((f for f in pg.frames if "pie-plaza" in f.url), None)
                    if frame: break
                    pg.wait_for_timeout(100)
                frame.wait_for_function("window.__plaza && window.__plaza.cloud && document.getElementById('cloud').textContent.includes('已同步')", timeout=20000)
                return pg, frame, errs

            pa, A, ea = device("u1", "[5,9,0,3,0]")
            def keyB(k):
                B.evaluate("window.focus()"); pb.keyboard.press(k)
            pb, B, eb = device("u2", "[2,4,1,6,2]")
            B.wait_for_timeout(600)

            # A 整理農場：清一格、翻土種番茄、換藍屋頂，然後發布家園
            A.evaluate(f"""(() => {{ const f = {P}.farm; delete f.debris['22,12']; f.tilled['22,12'] = {{ w: 0 }}; f.crops['22,12'] = {{ t: 'tomato', s: 2, w: 0 }};
              {P}.decor.ext.roof = 2; {P}.decor.style = 'houseWood'; {P}.touch(); return {P}.publish(); }})()""")
            A.wait_for_timeout(500)

            # B 打開拜訪名冊：線上名單與名冊都有 A
            B.click("#btn-visit"); B.wait_for_timeout(800)
            text = B.inner_text("#panel-body")
            check("阿派" in text and "在線上" in text, "B 的拜訪名冊列出線上的阿派")
            check(B.locator(".people").nth(2).locator(".person-row").count() >= 1, "鎮民名冊列出開放的家園")
            B.locator(".frame").screenshot(path=str(OUT / "visit_panel.png"))
            B.locator(".people").nth(0).locator("button", has_text="拜訪").first.click()
            B.wait_for_function(f"{P}.area === 'farm:u1'", timeout=8000)
            B.wait_for_timeout(400)
            check("阿派的農場" in B.inner_text("#room-title"), "B 進到阿派的農場（標題）")
            check(B.evaluate(f"{P}.map.objects.some(o => o.k === 'houseWood' && o.tint && o.tint.roof === 2)"), "看到阿派的木造農舍與藍屋頂")
            check(B.evaluate(f"{P}.map.farmObjects.some(o => o.k === 'tomato2')"), "看到阿派種的番茄")
            check(B.evaluate(f"{P}.farm.gold") == 100, "B 自己的金幣沒被動到")
            # 兩人在同一區看得到彼此（A 也走進自己的農場）
            A.evaluate(f"{P}.warp('farm', 'door')"); A.wait_for_timeout(800)
            check(A.evaluate(f"(({P}.people.get('u2') || {{}}).area)") == "farm:u1", "A 看到 B 在自己的農場")

            # B 幫忙澆水（A 在線上）
            B.evaluate(f"Object.assign({P}.me, {{x: 22 * 16 + 8, y: 11 * 16 + 12, dir: 0}})")
            keyB("5"); keyB(" "); B.wait_for_timeout(3500)
            check(A.evaluate(f"{P}.farm.tilled['22,12'].w") > 0, "B 幫 A 澆水，A 的農場真的變濕")
            check("澆了" in A.inner_text("#log"), "A 的聊天室顯示誰幫忙澆水")
            check(B.evaluate(f"{P}.farm.tilled['22,12']") is None, "B 自己的農場沒被改")
            # B 不能用鋤頭在別人家亂挖
            keyB("4"); B.evaluate(f"Object.assign({P}.me, {{x: 30 * 16 + 8, y: 12 * 16, dir: 0}})")
            check(B.evaluate("document.querySelectorAll('#toolbar button')[3].disabled"), "拜訪時鋤頭不能用")

            # B 在信箱：稱讚、留言、送禮、加好友
            B.evaluate(f"(() => {{ const f = {P}.farm; f.inv.pumpkin = 2; }})()")
            sign = B.evaluate(f"{P}.map.signs.find(s => s.action === 'visitor')")
            B.evaluate(f"Object.assign({P}.me, {{x: {sign['x']} + 14, y: {sign['y']}, dir: 2}})")
            keyB("e"); B.wait_for_timeout(400)
            for _ in range(4):
                if not B.is_visible("#dialog"): break
                keyB("e"); B.wait_for_timeout(250)
            check(B.is_visible("#panel") and "阿派的信箱" in B.inner_text("#panel-title"), "信箱前開啟訪客選單")
            B.locator("#panel button", has_text="稱讚").click(); B.wait_for_timeout(300)
            B.fill("#panel textarea", "你的番茄好漂亮！<script>alert(1)</script>")
            B.locator("#panel button", has_text="投進信箱").click(); B.wait_for_timeout(300)
            B.locator("#panel .grid-items button").first.click(); B.wait_for_timeout(400)
            check(B.evaluate(f"{P}.farm.inv.pumpkin") == 1, "送出一顆南瓜，B 的背包少一顆")
            B.locator("#panel button", has_text="加為好友").click(); B.wait_for_timeout(200)
            check(B.evaluate(f"{P}.social.friends.some(f => f.id === 'u1')"), "B 把阿派加為好友")
            B.locator(".frame").screenshot(path=str(OUT / "visitor_menu.png"))
            B.click("#panel-close")

            # A 收到通知與信件
            A.wait_for_function("document.getElementById('mail-badge').textContent >= '3'", timeout=8000)
            check(A.inner_text("#mail-badge") == "3", "A 的信箱徽章顯示 3 封")
            A.click("#btn-mail"); A.wait_for_timeout(600)
            mail_text = A.inner_text("#panel-body")
            check("番茄好漂亮" in mail_text and "<script>" in mail_text and A.eval_on_selector("#panel-body", "e => !e.querySelector('script')"), "留言以純文字顯示")
            A.locator(".frame").screenshot(path=str(OUT / "mailbox.png"))
            A.locator(".mail.gift button", has_text="收下").click(); A.wait_for_timeout(500)
            check(A.evaluate(f"{P}.farm.inv.pumpkin") == 1, "A 收下南瓜")
            A.locator(".mail.like button", has_text="收下").click(); A.wait_for_timeout(500)
            check(A.evaluate(f"{P}.social.likes") == 1, "A 收下稱讚，累積 1 個讚")
            A.click("#panel-close")
            # 表情
            A.evaluate(f"{P}.emote(0)"); B.wait_for_timeout(500)
            check(B.evaluate(f"(({P}.people.get('u1') || {{}}).emote || {{}}).n") == 27, "B 看到 A 的愛心表情")
            B.locator(".frame").screenshot(path=str(OUT / "visit_farm.png"))

            # A 關閉家園 → 新的訪客進不去
            A.evaluate(f"(() => {{ {P}.social.open = false; return {P}.publish(); }})()"); A.wait_for_timeout(500)
            B.evaluate(f"{P}.warp('plaza', 'center')"); B.evaluate(f"{P}.visits.clear()")
            B.evaluate(f"{P}.visit('u1', '阿派')"); B.wait_for_timeout(1200)
            check(B.evaluate(f"{P}.area") == "plaza" and "沒有開放" in B.inner_text("#toast"), "A 關閉家園後 B 進不去")
            check(not [e for e in ea + eb if "favicon" not in e], f"console 無錯誤 {ea[:2] + eb[:2]}")
            b.close()
    finally:
        srv.terminate()
        try:
            out = srv.communicate(timeout=5)[0].decode(errors="replace")
        except subprocess.TimeoutExpired:
            srv.kill(); out = ""
        redeem.shutdown(); parent.shutdown()
        if fails:
            print("--- server log ---\n" + out[-1500:])
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
