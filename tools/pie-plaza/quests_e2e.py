#!/usr/bin/env python3
"""鎮民手冊（每日委託＋集章）端到端：真的伺服器、一個帳號。

用法：python3 tools/pie-plaza/quests_e2e.py [截圖目錄]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-quests")
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
        A.click("#btn-book"); A.wait_for_timeout(500)
        check(A.is_visible("#panel") and "鎮民手冊" in A.inner_text("#panel-title"), "左下角「手冊」打開鎮民手冊")
        check(A.locator("#panel-body .event.quest").count() == 4, "今日委託三項＋全部完成加碼")
        A.locator(".frame").screenshot(path=str(OUT / "01_daily.png"))
        # 在農場收成第一個作物：伺服器發章、前端跳提示
        A.evaluate(f"{P}.warp('farm', 'door')"); A.wait_for_timeout(400)
        gold0 = A.evaluate(f"{P}.call('load').then((r) => r.me.gold)")
        for tool in ("hoe", "seed", "wateringcan"):
            A.evaluate(f"{P}.call('tool', {{ tool: '{tool}', x: 22, y: 12 }})")
        # 測試用：伺服器時間不能快轉，直接把作物改成熟（只有開發伺服器的資料庫）
        import json, sqlite3
        env_db = env.db
        A.wait_for_timeout(2500)        # 等伺服器寫回
        con = sqlite3.connect(env_db)
        data = json.loads(con.execute("SELECT data FROM plaza_players WHERE user_id='u1'").fetchone()[0])
        con.close()
        check(data.get("prog", {}).get("wish", 0) == 0 and "daily" in data, "伺服器存了委託進度")
        A.evaluate(f"{P}.call('wish').catch(() => {{}})"); A.wait_for_timeout(600)
        logs = A.inner_text("#log")
        A.click("#btn-book"); A.wait_for_timeout(500)
        A.locator("#panel-body .chips button").nth(1).click(); A.wait_for_timeout(300)
        check(A.locator("#panel-body .stamp").count() >= 30, "集章頁列出所有章")
        A.locator(".frame").screenshot(path=str(OUT / "02_stamps.png"))
        r = A.evaluate(f"{P}.call('quests')")
        wish = next(s for s in r["quests"]["stamps"] if s["id"] == "town_wish10")
        check(wish["have"] == 1 and wish["need"] == 10, "許願進度 1/10 記在集章")
        gold1 = A.evaluate(f"{P}.call('load').then((r) => r.me.gold)")
        daily_wish = any("許一次願" in d["text"] and d["done"] for d in r["quests"]["daily"])
        expect = {-10, 40, 10, 60, 70, 120} if daily_wish else {-10, 40}
        check(gold1 - gold0 in expect,
              f"許願花了 10 G，只有今日委託剛好是許願才多 20 G（{gold0} → {gold1}）")
        errs = [e for e in env.errors if "favicon" not in e]
        check(not errs, f"沒有前端錯誤 {errs[:3]}")
        print("log tail:", logs[-200:])
    print("FAILED" if fails else "ALL PASS", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
