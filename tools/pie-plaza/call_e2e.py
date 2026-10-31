#!/usr/bin/env python3
"""廣場派對召集端到端：A 在拔河報名等人 → 在農場的 B 收到橫幅 → 點了直接到拔河旁邊；之後鎮民補位開局。

用法：python3 tools/pie-plaza/call_e2e.py [截圖目錄]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-call")
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
        A.evaluate(f"{P}.warp('plaza', 'center')"); B.evaluate(f"{P}.warp('farm', 'door')")
        A.wait_for_timeout(500)
        r = A.evaluate(f"{P}.call('tug', {{ act: 'join' }})")
        check(r["tug"]["status"] == "open", "A 報名拔河，等人中")
        B.wait_for_selector(".town-call:not([hidden])", timeout=5000)
        check("拔河" in B.inner_text(".town-call"), f"B 收到召集橫幅：{B.inner_text('.town-call')}")
        B.locator(".frame").screenshot(path=str(OUT / "01_call.png"))
        B.locator(".town-call").click(); B.wait_for_timeout(900)
        join = B.evaluate(f"{P}.map.signs.find((t) => t.action === 'tug')")
        me = B.evaluate(f"{P}.me")
        check(B.evaluate(f"{P}.area") == "plaza" and abs(me["x"] - join["x"]) < 4 and abs(me["y"] - join["y"] - 18) < 4, "點橫幅直接走到拔河旁邊")
        r = B.evaluate(f"{P}.call('tug', {{ act: 'join' }})")
        check(len(r["tug"]["players"]) == 2, "B 也加入了（兩位真人）")
        for _ in range(30):
            v = A.evaluate(f"{P}.call('tug', {{ act: 'view' }})")
            if v["tug"]["status"] != "open":
                break
            A.wait_for_timeout(1000)
        check(any(p["id"].startswith("npc:") for p in v["tug"]["players"]), "等了一下鎮民來補位開局")
        errs = [e for e in env.errors if "favicon" not in e]
        check(not errs, f"沒有前端錯誤 {errs[:3]}")
    print("FAILED" if fails else "ALL PASS", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
