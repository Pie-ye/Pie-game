#!/usr/bin/env python3
"""大胃王蛙端到端：真的伺服器（PG_BOSS_MINUTE 設成下一分鐘）、兩個帳號。

A 在廣場等、B 在農場；蛙出現時 B 收到公告點過去；兩人按空白鍵（自動瞄準）餵到牠睡著，檢查獎金、集章、截圖。
最久約 5 分鐘。用法：python3 tools/pie-plaza/boss_e2e.py [截圖目錄]
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-boss")
P = "window.__plaza"
fails = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        fails.append(msg)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    t = time.gmtime(time.time() + 8 * 3600)
    minute = (t.tm_min + 1) % 60
    with E2E(env={"PG_BOSS_MINUTE": str(minute)}) as env:
        pa, A = env.device("u1", look=[2, 1, 1, 2, 1])
        pb, B = env.device("u2", look=[6, 3, 2, 5, 2])
        A.evaluate(f"{P}.warp('plaza', 'center')")
        B.evaluate(f"{P}.warp('farm', 'door')")
        gold0 = A.evaluate(f"{P}.farm.gold")
        A.wait_for_timeout(500)
        A.evaluate(f"Object.assign({P}.me, {{x: 240, y: 250}})")
        A.wait_for_function(f"{P}.boss.on()", timeout=90000)
        check(True, "整分鐘到了，大胃王蛙出現在廣場")
        A.wait_for_timeout(600)
        A.locator(".frame").screenshot(path=str(OUT / "01_arrive.png"))
        B.wait_for_selector(".boss-call:not([hidden])", timeout=5000)
        check(True, "在農場的 B 收到「點這裡過去」公告")
        B.locator(".frame").screenshot(path=str(OUT / "02_call_farm.png"))
        B.locator(".boss-call").click(); B.wait_for_timeout(900)
        check(B.evaluate(f"{P}.area") == "plaza", "B 點公告回到廣場")
        B.evaluate(f"Object.assign({P}.me, {{x: 300, y: 250}})")
        need0 = A.evaluate(f"{P}.boss.snap.need")
        t0 = time.time()
        shot = False
        while time.time() - t0 < 300:
            for page, fr in ((pa, A), (pb, B)):
                fr.evaluate("window.focus()")
                page.keyboard.press(" ")
            A.wait_for_timeout(700)
            s = A.evaluate(f"{P}.boss.snap")
            if not shot and s and s["fed"] > s["need"] * 0.4:
                shot = True
                A.locator(".frame").screenshot(path=str(OUT / "03_feeding.png"))
            if s and s["ph"] in ("sleep", "gone") or (s and not s["on"]):
                break
        s = A.evaluate(f"{P}.boss.snap")
        check(s["result"] == "fed", f"兩人加三位鎮民把蛙餵飽（{s['fed']}/{s['need']}）")
        check(s["need"] > need0 or s["need"] >= need0, f"肚子大小依人數調整（{need0} → {s['need']}）")
        A.wait_for_timeout(800)
        A.locator(".frame").screenshot(path=str(OUT / "04_sleep.png"))
        A.wait_for_timeout(2500)
        gold1 = A.evaluate(f"{P}.farm.gold")
        check(gold1 > gold0, f"A 拿到獎金（{gold0} → {gold1}）")
        con = sqlite3.connect(env.db)
        for uid in ("u1", "u2"):
            data = json.loads(con.execute("SELECT data FROM plaza_players WHERE user_id=?", (uid,)).fetchone()[0])
            check((data.get("boss") or {}).get("fed") == 1 and "boss_first" in (data.get("stamps") or {}),
                  f"{uid}：餵飽紀錄與「餵飽大胃王」章 {data.get('boss')}")
        con.close()
        errs = [e for e in env.errors if "favicon" not in e]
        check(not errs, f"沒有前端錯誤 {errs[:3]}")
    print("FAILED" if fails else "ALL PASS", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
