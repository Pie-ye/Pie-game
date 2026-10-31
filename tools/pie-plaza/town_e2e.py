#!/usr/bin/env python3
"""全鎮工程端到端：真的伺服器、兩個帳號。

A 從商店街東口走進派派新區，在建設委員會看板捐金幣；B 也在新區，聊天紀錄看到 A 捐了什麼；面板進度更新；截圖。
用法：python3 tools/pie-plaza/town_e2e.py [截圖目錄]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-town")
P = "window.__plaza"
fails = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        fails.append(msg)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with E2E() as env:
        pa, A = env.device("u1", look=[2, 1, 1, 2, 1])
        pb, B = env.device("u2", look=[6, 3, 2, 5, 2])
        B.evaluate(f"{P}.warp('frontier', 'west')"); B.wait_for_timeout(500)
        A.evaluate(f"{P}.warp('town', 'east')"); A.wait_for_timeout(400)
        A.evaluate("window.focus()"); pa.keyboard.down("d"); A.wait_for_timeout(700); pa.keyboard.up("d"); A.wait_for_timeout(800)
        check(A.evaluate(f"{P}.area") == "frontier", "A 從商店街東口走進派派新區")
        A.locator(".frame").screenshot(path=str(OUT / "01_frontier.png"))
        board = A.evaluate(f"{P}.map.signs.find((t) => t.action === 'town')")
        A.evaluate(f"Object.assign({P}.me, {{x: {board['x']}, y: {board['y'] + 14}, dir: 1}})"); A.wait_for_timeout(300)
        env.key(pa, A, "e"); A.wait_for_timeout(500)
        if A.is_visible("#dialog"):
            for _ in range(4):
                env.key(pa, A, "e"); A.wait_for_timeout(250)
        A.wait_for_selector("#panel:not([hidden])", timeout=4000)
        check("派派新區建設" in A.inner_text("#panel-title") and "派派溫室" in A.inner_text("#panel-body"), "看板打開工程面板：這一期是派派溫室")
        gold0 = A.evaluate(f"{P}.farm.gold")
        A.locator("#panel-body button", has_text="捐 金幣 ×10").first.click(); A.wait_for_timeout(700)
        check(A.evaluate(f"{P}.farm.gold") == gold0 - 10, "捐 10 G：金幣扣掉")
        check("1510 / 1500" not in A.inner_text("#panel-body") and "10 / 1500" in A.inner_text("#panel-body"), "面板進度更新成 10 / 1500")
        check("貢獻" in A.inner_text("#panel-body") and "阿派" in A.inner_text("#panel-body"), "貢獻排行出現阿派")
        A.locator(".frame").screenshot(path=str(OUT / "02_panel.png"))
        B.wait_for_timeout(500)
        check("阿派 為全鎮工程捐了 金幣 ×10" in B.inner_text("#log"), "在新區的 B 看到捐獻廣播")
        sign = A.evaluate(f"{P}.map.signs.find((t) => t.title === '派派溫室').lines[0]")
        check("施工" in sign, f"工地告示顯示施工中：{sign}")
        errs = [e for e in env.errors if "favicon" not in e]
        check(not errs, f"沒有前端錯誤 {errs[:3]}")
    print("FAILED" if fails else "ALL PASS", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
