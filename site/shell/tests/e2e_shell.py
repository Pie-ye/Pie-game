#!/usr/bin/env python3
"""Pie-game 外框 Playwright 端對端測試。

前置（brief 埠；以 ss 確認空著）：
  # 內容（CORS）— 本腳本預設自建暫存目錄，勿寫入 site/games/community/
  # 外框
  python3 -m http.server 54472 --bind 127.0.0.1 --directory site/shell
  # 可選：股票大亂鬥暫存 DB（真 API 登入）
  cd /home/pieye/Container/Retire-count-casino && \\
    SPROUT_DB=/tmp/pg-p2/t.db SPROUT_DATA_DIR=/tmp/pg-p2/data PORT=54462 \\
    CASINO_ORIGINS=http://localhost:54472 COOKIE_SECURE=0 python3 serve.py

執行：
  cd /home/pieye/Container/Pie-game-dev
  PG_START_SERVERS=1 python3 site/shell/tests/e2e_shell.py

環境變數：PG_SHELL（預設 http://localhost:54472）、PG_API、PG_CONTENT、
PG_SHOTS、PG_START_SERVERS=1 時由本腳本起 shell＋內容伺服器。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

REPO = Path(__file__).resolve().parents[3]
SHELL_DIR = REPO / "site" / "shell"
SHOTS = Path(os.environ.get("PG_SHOTS", str(REPO / ".devflow" / "shots")))
SHELL = os.environ.get("PG_SHELL", "http://localhost:54472")
API = os.environ.get("PG_API", "http://127.0.0.1:54462")
CONTENT = os.environ.get("PG_CONTENT", "http://127.0.0.1:54473")
MOCK_URL = f"{SHELL}/?api={API}&content={CONTENT}&mock=1"

failures: list[str] = []
passed = 0
_procs: list[subprocess.Popen] = []
_httpd = None


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failures.append(f"{name}: {detail}")
        print(f"FAIL  {name}: {detail}")


class _CorsHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


def _write_fixtures(root: Path) -> None:
    games = root / "games" / "community"
    for name, body in {
        "coin-flip": {
            "id": "coin-flip",
            "name": "猜硬幣",
            "kind": "coin",
            "multiplayer": False,
            "author": "Pie-ye",
            "entry": "index.html",
            "description": "猜正面或反面",
            "tags": ["金幣", "運氣"],
        },
        "snake": {
            "id": "snake",
            "name": "貪吃蛇",
            "kind": "free",
            "multiplayer": False,
            "author": "Pie-ye",
            "entry": "index.html",
            "description": "經典貪吃蛇",
            "tags": ["休閒"],
        },
        "tic-tac-toe": {
            "id": "tic-tac-toe",
            "name": "井字棋",
            "kind": "free",
            "multiplayer": True,
            "author": "Pie-ye",
            "entry": "index.html",
            "description": "兩人對戰",
            "tags": ["多人"],
        },
        "lucky-wheel": {
            "id": "lucky-wheel",
            "name": "幸運轉盤",
            "kind": "coin",
            "multiplayer": False,
            "author": "someone",
            "entry": "index.html",
            "description": "未通過驗證不該出現在金幣區",
            "tags": ["金幣"],
        },
        "tight-spread": {
            "id": "tight-spread",
            "name": "窄押注",
            "kind": "coin",
            "multiplayer": False,
            "author": "Pie-ye",
            "entry": "index.html",
            "description": "押注 6–9",
            "tags": ["金幣"],
        },
    }.items():
        d = games / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "game.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    (games / "index.json").write_text(
        json.dumps({"games": ["coin-flip", "snake", "tic-tac-toe", "lucky-wheel", "tight-spread"]}),
        encoding="utf-8",
    )
    (games / "coin-flip" / "index.html").write_text(
        """<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>猜硬幣</title></head>
<body>
<h1 id="title">猜硬幣</h1>
<p id="status">等待 init</p>
<p id="result"></p>
<button type="button" id="pickHeads">選正面</button>
<button type="button" id="pickTails">選反面</button>
<pre id="log"></pre>
<script>
window.addEventListener('message', (e) => {
  document.getElementById('log').textContent += JSON.stringify(e.data) + '\\n';
  const data = e.data || {};
  if (data.type === 'pg:init') {
    document.body.dataset.inited = '1';
    document.body.dataset.init = JSON.stringify(data);
    document.getElementById('title').textContent = data.gameId;
    document.getElementById('status').textContent = '已收到 pg:init';
  }
  if (data.type === 'pg:result') {
    document.body.dataset.result = JSON.stringify(data);
    document.getElementById('result').textContent = data.display || '';
  }
});
document.getElementById('pickHeads').onclick = () => parent.postMessage({type:'pg:select', choice:'heads'}, '*');
document.getElementById('pickTails').onclick = () => parent.postMessage({type:'pg:select', choice:'tails'}, '*');
parent.postMessage({type:'pg:ready'}, '*');
parent.postMessage({type:'pg:height', px: 420}, '*');
</script>
</body></html>""",
        encoding="utf-8",
    )
    (games / "snake" / "index.html").write_text(
        """<!DOCTYPE html><html><head><meta charset="utf-8"><title>貪吃蛇</title></head>
<body><h1>貪吃蛇</h1>
<script>
window.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'pg:result') document.body.dataset.result = JSON.stringify(data);
  if (data.type === 'pg:init') { document.body.dataset.inited = '1'; document.body.dataset.init = JSON.stringify(data); }
});
parent.postMessage({type:'pg:ready'}, '*');
parent.postMessage({type:'pg:height', px: 360}, '*');
</script></body></html>""",
        encoding="utf-8",
    )
    (games / "tic-tac-toe" / "index.html").write_text(
        """<!DOCTYPE html><html><head><meta charset="utf-8"><title>井字棋</title></head>
<body><h1>井字棋</h1>
<script>
window.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'pg:init') { document.body.dataset.inited = '1'; document.body.dataset.init = JSON.stringify(data); }
  if (data.type === 'pg:ticket') document.body.dataset.ticket = data.ticket || '';
});
parent.postMessage({type:'pg:ready'}, '*');
parent.postMessage({type:'pg:height', px: 360}, '*');
</script></body></html>""",
        encoding="utf-8",
    )
    (games / "tight-spread" / "index.html").write_text(
        """<!DOCTYPE html><html><head><meta charset="utf-8"><title>窄押注</title></head>
<body><h1>窄押注</h1>
<script>parent.postMessage({type:'pg:ready'}, '*');</script>
</body></html>""",
        encoding="utf-8",
    )
    (games / "lucky-wheel" / "index.html").write_text(
        "<!DOCTYPE html><title>x</title>", encoding="utf-8"
    )


def start_servers():
    global _httpd
    content_root = Path(tempfile.mkdtemp(prefix="pg-p2-content-"))
    _write_fixtures(content_root)
    os.chdir(content_root)
    _httpd = ThreadingHTTPServer(("127.0.0.1", 54473), _CorsHandler)
    import threading
    threading.Thread(target=_httpd.serve_forever, daemon=True).start()
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", "54472", "--bind", "127.0.0.1", "--directory", str(SHELL_DIR)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _procs.append(proc)
    for _ in range(40):
        try:
            import urllib.request
            urllib.request.urlopen(SHELL + "/", timeout=0.3)
            urllib.request.urlopen(CONTENT + "/games/community/index.json", timeout=0.3)
            return content_root
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("servers did not start")


def stop_servers(content_root: Path | None):
    global _httpd
    if _httpd:
        _httpd.shutdown()
        _httpd = None
    for p in _procs:
        p.terminate()
        try:
            p.wait(timeout=3)
        except Exception:
            p.kill()
    if content_root and content_root.exists():
        shutil.rmtree(content_root, ignore_errors=True)


def game_frame(page, game_id=None):
    for frame in page.frames:
        if frame is page.main_frame:
            continue
        url = frame.url or ""
        if "/games/community/" not in url:
            continue
        if game_id and f"/{game_id}/" not in url:
            continue
        return frame
    return None


def wait_inited(page, game_id=None, timeout_ms=5000):
    deadline = time.time() + timeout_ms / 1000
    frame = None
    while time.time() < deadline:
        frame = game_frame(page, game_id)
        if frame:
            try:
                if frame.evaluate("() => document.body.dataset.inited === '1'"):
                    return frame
            except Exception:
                pass
        page.wait_for_timeout(80)
    return frame


def login_mock(page):
    page.goto(MOCK_URL + "#/login")
    page.get_by_label("使用者名稱").fill("pgtest")
    page.get_by_label("密碼").fill("previewpass123")
    page.get_by_role("button", name="登入").click()
    expect(page.locator("#balancePill")).to_be_visible(timeout=5000)


def allowed_http_error(url: str, status: int) -> bool:
    if "favicon" in url:
        return True
    if status == 401 and "/api/casino/session" in url:
        return True
    return False


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    content_root = None
    if os.environ.get("PG_START_SERVERS") == "1":
        content_root = start_servers()

    console_errors: list[str] = []
    http_errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(str(err)))

        def on_response(res):
            if res.status >= 400 and not allowed_http_error(res.url, res.status):
                http_errors.append(f"{res.status} {res.url}")

        page.on("response", on_response)

        page.set_viewport_size({"width": 1280, "height": 800})

        # 2. guest can browse lobby (no redirect on community)
        page.goto(MOCK_URL + "#/")
        page.wait_for_selector("#lobbyOfficial")
        check("guest-lobby", page.get_by_role("heading", name="官方遊戲").count() == 1,
              page.locator("#view").inner_text()[:200])
        check("guest-not-login-page", page.locator("#loginForm").count() == 0, "redirected to login")

        login_mock(page)
        check("login-balance", "金幣" in (page.locator("#balancePill").inner_text() or ""),
              page.locator("#balancePill").inner_text())
        check("login-user", "pgtest" in page.locator("#authSlot").inner_text(),
              page.locator("#authSlot").inner_text())

        page.goto(MOCK_URL + "#/")
        page.wait_for_selector("#lobbyOfficial .game-card")
        for heading in ("官方遊戲", "金幣遊戲", "一般遊戲", "多人遊戲"):
            loc = page.get_by_role("heading", name=heading)
            check(f"lobby-heading-{heading}", loc.count() == 1, f"count={loc.count()}")
        check("lobby-official-six", page.locator("#lobbyOfficial .game-card").count() == 6,
              str(page.locator("#lobbyOfficial .game-card").count()))
        check("lobby-coin-flip", page.locator("#lobbyCoin").get_by_text("猜硬幣").count() >= 1,
              page.locator("#lobbyCoin").inner_text())
        check("lobby-no-lucky-wheel", page.locator("#lobbyCoin").get_by_text("幸運轉盤").count() == 0,
              page.locator("#lobbyCoin").inner_text())
        check("lobby-no-rejected", "bad-game" not in page.locator("#view").inner_text(),
              page.locator("#view").inner_text()[:300])
        check("lobby-snake", page.locator("#lobbyFree").get_by_role("heading", name="貪吃蛇").count() == 1,
              page.locator("#lobbyFree").inner_text())
        check("lobby-ttt", page.locator("#lobbyMulti").get_by_text("井字棋").count() >= 1,
              page.locator("#lobbyMulti").inner_text())

        page.get_by_role("link", name="拉霸").click()
        page.wait_for_selector(".placeholder-msg, #officialRoot")
        check("official-placeholder", page.get_by_text("搬家中，即將開放").count() >= 1
              or page.locator("#officialRoot").count() == 1,
              page.locator("#view").inner_text()[:300])

        page.goto(MOCK_URL + "#/")
        page.wait_for_selector("#lobbyOfficial .game-card")
        page.wait_for_timeout(500)
        for theme in ("playful", "studio", "classic"):
            page.locator("#themeSelect").select_option(theme)
            page.wait_for_timeout(150)
            html_theme = page.locator("html").get_attribute("data-theme")
            check(f"theme-{theme}", html_theme == theme, html_theme or "")
            page.set_viewport_size({"width": 1280, "height": 800})
            page.screenshot(path=str(SHOTS / f"p2-{theme}-1280.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 844})
            page.screenshot(path=str(SHOTS / f"p2-{theme}-390.png"), full_page=True)
        page.set_viewport_size({"width": 1280, "height": 800})

        # user menu 390 / 360
        for w in (390, 360):
            page.set_viewport_size({"width": w, "height": 800})
            page.wait_for_timeout(150)
            toggle = page.locator("#userMenuToggle")
            check(f"user-menu-toggle-{w}", toggle.is_visible(), f"visible={toggle.is_visible()}")
            logout = page.locator("#logoutBtn")
            check(f"user-menu-logout-hidden-{w}", not logout.is_visible(), "logout still visible")
            toggle.click()
            check(f"user-menu-open-{w}", page.locator("#logoutBtn").is_visible(), "logout not in dropdown")
            page.screenshot(path=str(SHOTS / f"p2-usermenu-{w}.png"))
            page.locator("body").click(position={"x": 2, "y": 2})
        page.set_viewport_size({"width": 1280, "height": 800})

        page.goto(MOCK_URL + "#/game/coin-flip")
        page.wait_for_selector("iframe.community-frame")
        iframe = page.locator("iframe.community-frame")
        check("iframe-sandbox", iframe.get_attribute("sandbox") == "allow-scripts allow-same-origin allow-pointer-lock",
              iframe.get_attribute("sandbox") or "")
        check("iframe-allow", "fullscreen" in (iframe.get_attribute("allow") or ""), iframe.get_attribute("allow") or "")
        check("iframe-title", bool(iframe.get_attribute("title")), iframe.get_attribute("title") or "")
        frame = wait_inited(page, "coin-flip")
        check("pg-init-received", bool(frame) and frame.evaluate("() => document.body.dataset.inited === '1'"),
              "no init")
        if frame:
            init = frame.evaluate("() => JSON.parse(document.body.dataset.init || '{}')")
            check("pg-init-gameId", init.get("gameId") == "coin-flip", str(init))
            check("pg-init-user", isinstance(init.get("user"), dict) and init["user"].get("id"), str(init.get("user")))
            height = page.locator("iframe.community-frame").evaluate("el => el.style.height")
            check("pg-height", height == "420px", height)

        page.evaluate("() => { document.cookie = 'pg_shell=secret-shell-cookie; path=/'; }")
        if frame:
            iframe_cookie = frame.evaluate("() => document.cookie")
            check("iframe-cookie-isolated", "pg_shell" not in (iframe_cookie or ""), iframe_cookie)

        page.evaluate("() => window.postMessage({type: 'pg:select', choice: 'tails'}, '*')")
        page.wait_for_timeout(150)
        after = page.locator(".choice-btn.is-active").inner_text() if page.locator(".choice-btn.is-active").count() else ""
        check("ignore-wrong-origin", "反面" not in after, f"after={after!r}")

        check("bet-bar", page.locator("#coinBetBar").count() == 1, "missing")
        check("rtp-note", page.get_by_text("長期玩一定虧").count() >= 1, page.locator("#coinBetBar").inner_text())

        # 10. pg:select updates RTP note
        page.locator(".choice-btn[data-choice='tails']").click()
        check("rtp-click-tails", "90%" in page.locator(".rtp-note").inner_text(), page.locator(".rtp-note").inner_text())
        if frame:
            frame.locator("#pickHeads").click()
            page.wait_for_timeout(200)
        check("rtp-pg-select-heads", "96%" in page.locator(".rtp-note").inner_text(), page.locator(".rtp-note").inner_text())
        check("choice-heads-active", page.locator(".choice-btn[data-choice='heads']").get_attribute("aria-pressed") == "true",
              page.locator(".choice-btn.is-active").inner_text())

        page.locator(".choice-btn[data-choice='heads']").click()
        page.locator(".bet-btn[data-bet='5']").click()
        page.locator("#playBtn").click()
        page.wait_for_timeout(900)
        if frame:
            result = frame.evaluate("() => document.body.dataset.result || ''")
            check("pg-result", "bet" in result, result)
        check("play-toast", bool(page.locator("#toast").inner_text()), page.locator("#toast").inner_text())
        history_text = page.locator("#historyRoot").inner_text()
        check("history-after-play", "局" in history_text or "押注" in history_text, history_text)

        # session 失效後下注 → 清本地登入狀態、就地叫出登入框、遊戲頁留在原處
        if frame:
            frame.evaluate("() => { delete document.body.dataset.result; }")
        page.evaluate("() => window.__pgMock.expireSession()")
        page.locator("#playBtn").click()
        expect(page.locator("#loginDialog #loginForm")).to_be_visible(timeout=5000)
        check("expired-play-login-dialog", page.locator("#loginDialog").count() == 1, "no login dialog")
        check("expired-play-keeps-game", page.locator("iframe.community-frame").count() == 1,
              "game page was torn down")
        check("expired-play-chrome-logged-out", not page.locator("#balancePill").is_visible(),
              "balance pill still visible after 401")
        check("expired-play-no-result", not (frame and frame.evaluate("() => document.body.dataset.result || ''")),
              "iframe got a pg:result from a 401 play")

        page.screenshot(path=str(SHOTS / "p2-login-dialog-1280.png"))
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(150)
        page.screenshot(path=str(SHOTS / "p2-login-dialog-390.png"))
        page.set_viewport_size({"width": 1280, "height": 800})
        page.wait_for_timeout(150)

        # 登入後可以直接繼續下注
        page.locator("#loginDialog input[name='username']").fill("pgtest")
        page.locator("#loginDialog input[name='password']").fill("previewpass123")
        page.locator("#loginDialog button[type='submit']").click()
        expect(page.locator("#balancePill")).to_be_visible(timeout=5000)
        check("expired-relogin-closes-dialog", page.locator("#loginDialog").count() == 0, "dialog still open")
        check("expired-relogin-keeps-game", page.locator("iframe.community-frame").count() == 1,
              "game page was torn down after re-login")
        page.locator("#playBtn").click()
        page.wait_for_timeout(900)
        resumed = frame.evaluate("() => document.body.dataset.result || ''") if frame else ""
        check("expired-relogin-can-play", "bet" in resumed, resumed)

        # session 失效時按登出：伺服器回 401，本機狀態一樣要清掉
        page.evaluate("() => window.__pgMock.expireSession()")
        page.locator("#logoutBtn").click()
        page.wait_for_timeout(500)
        check("logout-401-clears-local", page.locator("#authSlot").get_by_role("link", name="登入").count() == 1,
              page.locator("#authSlot").inner_text())
        check("logout-401-hides-balance", not page.locator("#balancePill").is_visible(), "balance pill still visible")
        check("logout-401-toast", "已登出" in page.locator("#toast").inner_text(), page.locator("#toast").inner_text())
        login_mock(page)

        # 4. min-max with no intersection against 5/10/20/50/100
        page.goto(MOCK_URL + "#/game/tight-spread")
        page.wait_for_selector("#coinBetBar")
        bets = page.locator(".bet-btn").all_inner_texts()
        check("tight-bets", bets == ["6", "9"], str(bets))

        # 1. race: play A then switch to B — B must not get pg:result
        page.goto(MOCK_URL + "#/game/coin-flip")
        page.wait_for_selector("#playBtn")
        wait_inited(page, "coin-flip")
        page.locator("#playBtn").click()
        page.evaluate("() => { location.hash = '#/game/snake'; }")
        page.wait_for_selector("iframe.community-frame")
        snake = wait_inited(page, "snake")
        page.wait_for_timeout(700)
        leaked = ""
        if snake:
            leaked = snake.evaluate("() => document.body.dataset.result || ''")
        check("race-no-stale-result", not leaked, leaked)

        page.goto(MOCK_URL + "#/game/coin-flip")
        page.wait_for_selector("#coinBetBar")
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(200)
        bar = page.locator("#coinBetBar")
        box = bar.bounding_box()
        vp = page.viewport_size
        if box and vp:
            fully_in = box["y"] >= 0 and (box["y"] + box["height"]) <= vp["height"] + 1
            check("mobile-betbar-in-view", fully_in, str(box) + str(vp))
            page.screenshot(path=str(SHOTS / "p2-mobile-betbar.png"))
        else:
            check("mobile-betbar-in-view", False, f"box={box}")
        page.set_viewport_size({"width": 1280, "height": 800})

        page.locator("#logoutBtn").click()
        page.wait_for_timeout(400)
        page.goto(MOCK_URL + "#/game/tic-tac-toe")
        page.wait_for_selector("iframe.community-frame")
        check("mp-login-banner", page.get_by_text("登入後才能加入多人房間").count() == 1,
              page.locator("#view").inner_text()[:300])
        frame2 = wait_inited(page, "tic-tac-toe")
        if frame2:
            init2 = frame2.evaluate("() => JSON.parse(document.body.dataset.init || '{}')")
            check("mp-user-null", init2.get("user") is None, str(init2))
            check("mp-no-ticket", "ticket" not in init2 or init2.get("ticket") in (None, ""), str(init2))
        else:
            check("mp-user-null", False, "no frame")

        check("a11y-login-named", page.get_by_role("link", name="登入").count() >= 1, "missing")
        page.goto(MOCK_URL + "#/game/coin-flip")
        page.wait_for_selector("iframe.community-frame")
        check("a11y-fullscreen", page.get_by_role("button", name="全螢幕").count() == 1, "missing")

        # real API login (same-site localhost)
        try:
            import urllib.error
            import urllib.request
            urllib.request.urlopen(API.replace("127.0.0.1", "localhost") + "/api/auth/me", timeout=2)
            casino_up = True
        except urllib.error.HTTPError:
            casino_up = True
        except Exception:
            casino_up = False
        if casino_up:
            same_site_api = API.replace("127.0.0.1", "localhost")
            real_local = f"{SHELL}/?api={same_site_api}&content={CONTENT}"
            page.goto(real_local + "#/login")
            page.get_by_label("使用者名稱").fill("pgtest")
            page.get_by_label("密碼").fill("previewpass123")
            page.get_by_role("button", name="登入").click()
            page.wait_for_timeout(2000)
            logged = "pgtest" in page.locator("#authSlot").inner_text()
            check("real-api-login", logged, page.locator("#authSlot").inner_text() + " | " + page.locator("#toast").inner_text())
        else:
            print("SKIP  real-api (casino not reachable)")

        page_errors = [
            e for e in console_errors
            if e
            and "favicon" not in e.lower()
            and not (
                "401" in e and "Unauthorized" in e
            )
        ]
        check("console-clean", len(page_errors) == 0 and len(http_errors) == 0,
              "; ".join(page_errors[:6] + http_errors[:6]))

        browser.close()

    stop_servers(content_root)
    print(f"\n{passed} passed, {len(failures)} failed")
    for f in failures:
        print(" -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        stop_servers(None)
        raise
