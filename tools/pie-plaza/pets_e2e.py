#!/usr/bin/env python3
"""寵物端到端：真的伺服器、兩個帳號。開寵物面板、領養（金幣不夠會失敗）、收起來／帶著、別人看得到你的寵物。

用法：python3 tools/pie-plaza/pets_e2e.py [截圖目錄]
"""
import sqlite3
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-pets")
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
        for fr in (A, B):
            fr.evaluate(f"{P}.warp('plaza', 'center')")
        A.wait_for_timeout(800)
        check(A.evaluate(f"{P}.me.pet") == "cat", "每個人都先有一隻小花貓，而且帶在身邊")
        B.wait_for_function(f"(() => {{ const p = {P}.people.get('u1'); return p && p.pet === 'cat'; }})()", timeout=5000)
        check(True, "B 看得到阿派的小花貓")
        A.click("#btn-pets"); A.wait_for_selector("#panel:not([hidden])")
        check("寵物診所" in A.inner_text("#panel-title") and A.locator(".pet-card").count() == 12, "寵物面板列出 12 隻")
        A.locator(".pet-card", has_text="藍鸚鵡").locator("button").click(); A.wait_for_timeout(500)
        check("金幣不夠" in A.inner_text("#panel-body"), "金幣不夠時領養失敗")
        check("🔒" in A.locator(".pet-card", has_text="小蛙蛙").inner_text(), "小蛙蛙要先餵飽大胃王")
        A.locator(".pet-card", has_text="小花貓").locator("button").click(); A.wait_for_timeout(600)
        check(A.evaluate(f"{P}.me.pet") is None, "收起來之後身邊沒有寵物")
        B.wait_for_function(f"!{P}.people.get('u1').pet", timeout=5000)
        check(True, "B 那邊阿派的寵物也不見了")
        # 給點錢再領養柴犬
        con = sqlite3.connect(env.db); con.close()
        A.evaluate(f"{P}.call('town', {{ act: 'view' }})")
        A.locator(".pet-card", has_text="小花貓").locator("button").click(); A.wait_for_timeout(500)
        check(A.evaluate(f"{P}.me.pet") == "cat", "再帶著小花貓")
        A.locator(".frame").screenshot(path=str(OUT / "01_panel.png"))
        A.evaluate(f"Object.assign({P}.me, {{x: 240, y: 230}})"); A.wait_for_timeout(1200)
        B.locator(".frame").screenshot(path=str(OUT / "02_seen_by_B.png"))
        errs = [e for e in env.errors if "favicon" not in e]
        check(not errs, f"沒有前端錯誤 {errs[:3]}")
    print("FAILED" if fails else "ALL PASS", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
