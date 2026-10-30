#!/usr/bin/env python3
"""pie-plaza 地圖導覽截圖：用假 SDK 開一個分頁，逐一傳送到各地區並截圖。

用法：python3 tools/pie-plaza/tour.py [輸出目錄]
"""
import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import STUB_SDK, SITE, Quiet  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-tour")
STOPS = [
    ("plaza", "center", None), ("plaza", "west", None), ("town", "west", None),
    ("town", "west", (448, 260)), ("town", "west", (760, 230)), ("town", "west", (400, 400)),
    ("shop:general", "door", None), ("shop:bakery", "door", None), ("shop:diner", "door", None),
    ("shop:smith", "door", None), ("shop:carpenter", "door", None), ("shop:clinic", "door", None),
    ("farm", "door", None), ("farm", "east", None), ("farm", "door", (320, 330)), ("house", "door", None),
]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/games/community/pie-plaza/index.html"
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 760})
        ctx.route("**/sdk/pie-game-sdk.js", lambda r: r.fulfill(body=STUB_SDK, content_type="text/javascript"))
        pg = ctx.new_page()
        pg.add_init_script("window.__PLAYER = {id:'u1',username:'阿派',displayName:'阿派'};")
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url)
        pg.wait_for_function("window.__plaza && window.__plaza.map", timeout=15000)
        pg.wait_for_timeout(800)
        for i, (area, entry, pos) in enumerate(STOPS):
            pg.evaluate(f"window.__plaza.warp({area!r}, {entry!r})")
            if pos:
                pg.evaluate(f"Object.assign(window.__plaza.me, {{x:{pos[0]}, y:{pos[1]}}})")
            pg.wait_for_timeout(450)
            name = f"{i:02d}_{area.replace(':', '_')}_{entry}.png"
            pg.locator(".frame").screenshot(path=str(OUT / name))
            print("shot", name)
        b.close()
    srv.shutdown()
    print("errors:", errors[:5])
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
