#!/usr/bin/env python3
"""限時尋寶端到端（活動期間才會通過）：南瓜燈出現在地圖上、走過去按 E 收下、金幣入帳、同一顆不能再拿。

用法：python3 tools/pie-plaza/hunt_e2e.py [截圖目錄]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-hunt")
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
        r = A.evaluate(f"{P}.call('hunt', {{ act: 'view' }})")
        if not r["hunt"]["on"]:
            print("SKIP 現在沒有尋寶活動"); return 0
        check("尋寶" in A.inner_text("#log"), "登入時聊天紀錄介紹今天的尋寶")
        spot = next(s for s in r["hunt"]["spots"] if s["map"] == "plaza")
        A.evaluate(f"{P}.warp('plaza', 'center')"); A.wait_for_timeout(400)
        check(A.evaluate(f"{P}.map.signs.some((t) => t.action === 'hunt' && t.id === '{spot['id']}')"), "廣場上有今天的南瓜燈")
        A.evaluate(f"Object.assign({P}.me, {{x: {spot['x']}, y: {spot['y'] + 12}, dir: 1}})"); A.wait_for_timeout(400)
        A.locator(".frame").screenshot(path=str(OUT / "01_pumpkin.png"))
        gold0 = A.evaluate(f"{P}.farm.gold")
        env.key(pa, A, "e"); A.wait_for_timeout(700)
        check(A.evaluate(f"{P}.farm.gold") == gold0 + 15, "按 E 收下南瓜燈 +15 G")
        check(not A.evaluate(f"{P}.map.signs.some((t) => t.action === 'hunt' && t.id === '{spot['id']}')"), "收下後地圖上的南瓜燈消失")
        again = A.evaluate(f"{P}.call('hunt', {{ act: 'find', id: '{spot['id']}', x: {spot['x']}, y: {spot['y']} }}).then(() => 'ok', (e) => e.code)")
        check(again == "found", "同一顆不能再拿")
        errs = [e for e in env.errors if "favicon" not in e]
        check(not errs, f"沒有前端錯誤 {errs[:3]}")
    print("FAILED" if fails else "ALL PASS", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
