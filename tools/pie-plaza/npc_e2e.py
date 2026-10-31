#!/usr/bin/env python3
"""鎮民好感與烤派端到端：真的伺服器、一個帳號。

割草拿纖維 → 進瑪莉麵包店對話 → 互動面板（心數、烤派、送禮）→ 送纖維看反應、同一天不能再送 → 烤派面板顯示材料不夠。
用法：python3 tools/pie-plaza/npc_e2e.py [截圖目錄]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-npc")
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
        A.evaluate(f"{P}.warp('farm', 'door')"); A.wait_for_timeout(400)
        weed = A.evaluate(f"Object.entries({P}.farm.debris).find(([k, d]) => d.t === 'weed')[0]")
        wx, wy = map(int, weed.split(","))
        A.evaluate(f"{P}.call('tool', {{ tool: 'sickle', x: {wx}, y: {wy} }})")
        A.evaluate(f"{P}.reload()"); A.wait_for_timeout(300)
        check(A.evaluate(f"{P}.farm.inv.fiber") == 1, "割草拿到 1 個纖維")
        A.evaluate(f"{P}.warp('shop:bakery', 'door')"); A.wait_for_timeout(400)
        mary = A.evaluate(f"{P}.map.npcs[0]")
        A.evaluate(f"Object.assign({P}.me, {{x: {mary['x']}, y: {mary['y'] + 24}, dir: 1}})"); A.wait_for_timeout(300)
        for _ in range(16):
            env.key(pa, A, "e"); A.wait_for_timeout(250)
            if A.is_visible("#panel"):
                break
        A.locator(".frame").screenshot(path=str(OUT / "00_talk.png"))
        print("dialog:", A.is_visible("#dialog"), A.inner_text("#dialog") if A.is_visible("#dialog") else "", "hint", A.evaluate(f"(() => {{ const t = {P}.map.interactAt({P}.me); return t && (t.name || t.title); }})()"))
        check(A.is_visible("#panel") and "瑪莉" in A.inner_text("#panel-title"), "和瑪莉說完話打開互動面板")
        body = A.inner_text("#panel-body")
        check("♡" in body and "烤派" in body and "送禮" in body, "面板有心數、烤派按鈕、送禮")
        A.locator(".gifts button", has_text="纖維").click(); A.wait_for_timeout(600)
        body = A.inner_text("#panel-body")
        check("謝謝" in body and "今天已經送過瑪莉了" in body, f"送纖維有反應，今天不能再送")
        check("瑪莉回禮" not in body, "還沒到 2 心，不會誤報回禮")
        A.locator(".frame").screenshot(path=str(OUT / "01_gift.png"))
        A.locator("#panel-body button", has_text="烤派").click(); A.wait_for_timeout(400)
        check("烤派" in A.inner_text("#panel-title") and "草莓派" in A.inner_text("#panel-body"), "烤派面板列出五種派")
        A.locator(".frame").screenshot(path=str(OUT / "02_bake.png"))
        errs = [e for e in env.errors if "favicon" not in e]
        check(not errs, f"沒有前端錯誤 {errs[:3]}")
    print("FAILED" if fails else "ALL PASS", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
