#!/usr/bin/env python3
"""量測外框從開頁到「遊戲可以玩」的時間（Playwright／Chromium）。

用法：
  python3 tools/perf_load.py                       # 正式站，冷快取＋熱快取各 3 次
  python3 tools/perf_load.py --shell http://localhost:54470 --runs 5
  python3 tools/perf_load.py --routes '#/game/slots' '#/game/snake'

「可以玩」的定義（訪客身分）：
- 大廳：四個區塊都畫出來（目錄與 /api/casino/community 都回來了）。
- 官方遊戲：遊戲模組掛上、遊戲 CSS 套用、第一個設定請求回來
  （訪客會拿到 401 → 跳出登入框，這也算載入完成）。
- 投稿遊戲：iframe 收到外框的 pg:init（SDK 套上 data-theme），且不是 2 秒逾時的獨立模式。

冷快取＝每次新的 browser context；熱快取＝同一個 context 重新整理。
--click：先開大廳等它好，再點遊戲卡片，量「點下去到可以玩」（玩家最常走的路）。
"""
from __future__ import annotations

import argparse
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

DEFAULT_ROUTES = ["#/", "#/game/slots", "#/game/snake", "#/game/coin-flip"]

LOBBY_READY = """() => {
  const ids = ['lobbyOfficial', 'lobbyCoin', 'lobbyFree', 'lobbyMulti'];
  return ids.every((id) => document.getElementById(id));
}"""

OFFICIAL_READY = """() => {
  const root = document.getElementById('officialRoot');
  if (!root || !root.querySelector('.official-balance')) return false;
  const css = Array.from(document.querySelectorAll('link[data-pg-official-style]'));
  if (!css.length || !css.every((l) => l.sheet)) return false;
  if (document.getElementById('loginDialog')) return true;
  const panel = root.querySelector('[id^="casino"], [id^="pk"], [id^="bj"]') || root.lastElementChild;
  return Boolean(panel && panel.innerHTML && !/載入/.test(panel.textContent || ''));
}"""


def wait_community(page, deadline: float) -> bool:
    while time.monotonic() < deadline:
        frame = next((f for f in page.frames if "/games/community/" in f.url), None)
        if frame is not None:
            try:
                if frame.evaluate("() => Boolean(document.documentElement.dataset.theme) && document.readyState !== 'loading'"):
                    return True
            except Exception:
                pass
        page.wait_for_timeout(10)
    return False


OFFICIAL_IDS = {"slots", "blackjack", "poker", "dragon", "niuniu", "baccarat"}


def wait_ready(page, route: str, start: float, timeout_s: float) -> float | None:
    deadline = start + timeout_s
    try:
        if route in ("#/", ""):
            page.wait_for_function(LOBBY_READY, timeout=timeout_s * 1000, polling=10)
        elif route.startswith("#/game/") and route.split("/")[-1] in OFFICIAL_IDS:
            page.wait_for_function(OFFICIAL_READY, timeout=timeout_s * 1000, polling=10)
        else:
            if not wait_community(page, deadline):
                return None
    except Exception:
        return None
    return time.monotonic() - start


def measure(page, url: str, route: str, timeout_s: float) -> float | None:
    start = time.monotonic()
    page.goto(url + route, wait_until="commit")
    return wait_ready(page, route, start, timeout_s)


def measure_click(page, url: str, route: str, timeout_s: float, *, settle_ms: int) -> float | None:
    """開大廳 → 等一下（像玩家在看清單）→ 點卡片 → 量到可以玩。"""
    page.goto(url + "#/", wait_until="commit")
    if wait_ready(page, "#/", time.monotonic(), timeout_s) is None:
        return None
    page.wait_for_timeout(settle_ms)
    game_id = route.split("/")[-1]
    start = time.monotonic()
    page.click(f'a.game-card[href="#/game/{game_id}"]')
    return wait_ready(page, route, start, timeout_s)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--shell", default="https://game.coinpilet.win")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--routes", nargs="*", default=DEFAULT_ROUTES)
    parser.add_argument("--budget", type=float, default=1.0, help="秒；中位數超過就回非零")
    parser.add_argument("--click", action="store_true", help="從大廳點卡片進遊戲")
    parser.add_argument("--settle", type=int, default=1500, help="--click 時大廳好了之後等幾毫秒再點")
    args = parser.parse_args()
    if args.click:
        args.routes = [r for r in args.routes if r.startswith("#/game/")]

    def run_once(page, route: str) -> float | None:
        if args.click:
            return measure_click(page, url, route, args.timeout, settle_ms=args.settle)
        return measure(page, url, route, args.timeout)

    url = args.shell.rstrip("/") + "/"

    over_budget = False
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        print(f"{'route':<22}{'cold med':>10}{'cold max':>10}{'warm med':>10}{'warm max':>10}")
        for route in args.routes:
            cold: list[float] = []
            warm: list[float] = []
            failed = 0
            for _ in range(args.runs):
                context = browser.new_context()
                page = context.new_page()
                first = run_once(page, route)
                if first is None:
                    failed += 1
                else:
                    cold.append(first)
                # 熱快取：同一個 context，先回空白頁再開，模擬回訪。
                page.goto("about:blank")
                second = run_once(page, route)
                if second is None:
                    failed += 1
                else:
                    warm.append(second)
                context.close()

            def fmt(values: list[float], fn) -> str:
                return f"{fn(values):.3f}" if values else "—"

            print(
                f"{route:<22}{fmt(cold, statistics.median):>10}{fmt(cold, max):>10}"
                f"{fmt(warm, statistics.median):>10}{fmt(warm, max):>10}"
                + (f"  失敗 {failed}" if failed else "")
            )
            if failed or (cold and statistics.median(cold) > args.budget):
                over_budget = True
        browser.close()
    return 1 if over_budget else 0


if __name__ == "__main__":
    sys.exit(main())
