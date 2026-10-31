#!/usr/bin/env python3
"""派派鎮伺服器權威版的端到端測試：真的伺服器、兩～三個帳號、各自的瀏覽器。

涵蓋：資料在伺服器（清掉瀏覽器存檔重新整理還在）、拜訪與權限、共同耕作（即時同步、收成歸主人）、
跳蚤市場（上架、購買、賣家離線也入帳、成交通知）、送禮與收禮、釣魚、餵瑞吉、許願池、防偽造。
用法：python3 tools/pie-plaza/server_e2e.py [截圖目錄]
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-server")
P = "window.__plaza"
fails = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


def rows(db, sql, *args):
    con = sqlite3.connect(db); out = con.execute(sql, args).fetchall(); con.close(); return out


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with E2E() as env:
        pa, A = env.device("u1")
        check(A.is_visible(".creator"), "A：新帳號先捏臉")
        A.locator(".creator-faces button").nth(5).click(); A.locator(".creator .primary").click()
        A.wait_for_timeout(300)
        check("伺服器" in A.inner_text("#cloud"), "A：頁首顯示資料存在伺服器")

        # ---- 1. 自己的農場：動作都送到伺服器 ----
        A.evaluate(f"{P}.warp('farm', 'door')"); A.wait_for_timeout(500)
        weed = A.evaluate(f"Object.entries({P}.farm.debris).find(([k, d]) => d.t === 'weed')[0]")
        wx, wy = map(int, weed.split(","))
        r = A.evaluate(f"{P}.call('tool', {{ tool: 'sickle', x: {wx}, y: {wy} }})")
        check(r["result"]["cleared"] == "weed" and r["inv"].get("fiber") == 1, "伺服器處理鐮刀：雜草清掉、纖維進背包")
        for tool in ("hoe", "seed", "wateringcan"):
            A.evaluate(f"{P}.call('tool', {{ tool: '{tool}', x: 22, y: 12 }})")
        A.evaluate(f"{P}.reload()"); A.wait_for_timeout(200)
        check(A.evaluate(f"{P}.farm.crops['22,12'] && {P}.farm.crops['22,12'].t") == "wheat", "翻土、播種、澆水都在伺服器生效")
        # 用鍵盤操作（畫面預測＋伺服器確認）
        A.evaluate(f"Object.assign({P}.me, {{x: 23 * 16 + 8, y: 12 * 16 - 3, dir: 0}})")
        A.evaluate(f"{P}.call('tool', {{ tool: 'sickle', x: 23, y: 12 }}).catch(() => {{}})")
        A.evaluate(f"(() => {{ const f = {P}.farm; delete f.debris['23,12']; }})()")
        env.key(pa, A, "4"); env.key(pa, A, " "); A.wait_for_timeout(800)
        server_tile = rows(env.db, "SELECT data FROM plaza_players WHERE user_id='u1'")
        # 清掉瀏覽器存檔再重新整理：進度來自伺服器
        A.evaluate("localStorage.clear()")
        pa.reload()
        A = next(f for f in pa.frames if "pie-plaza" in f.url)
        A.wait_for_function("window.__plaza && window.__plaza.ready && window.__plaza.server", timeout=20000)
        A.wait_for_timeout(500)
        check(not A.is_visible(".creator"), "清掉瀏覽器存檔後不用重新捏臉（外觀在伺服器）")
        check(A.evaluate(f"{P}.farm.crops['22,12'] && {P}.farm.crops['22,12'].t") == "wheat" and A.evaluate(f"{P}.farm.inv.fiber") == 1,
              "清掉瀏覽器存檔、重新整理後農場與背包都還在")
        check(A.evaluate("Object.keys(localStorage).filter(k => k.startsWith('pie-plaza:farm') || k.startsWith('pie-plaza:decor')).length") == 0,
              "瀏覽器不再保存農場與小屋")

        # ---- 2. 拜訪與權限 ----
        pb, B = env.device("u2", look=[2, 4, 1, 6, 2])
        B.wait_for_timeout(400)
        B.evaluate(f"{P}.visit('u1', '阿派')")
        B.wait_for_function(f"{P}.area === 'farm:u1'", timeout=8000); B.wait_for_timeout(400)
        check("阿派的農場" in B.inner_text("#room-title") and B.evaluate(f"{P}.map.farmObjects.some(o => o.k === 'wheat0')"), "B 拜訪阿派的農場，看到伺服器上的小麥")
        denied = B.evaluate(f"{P}.call('tool', {{ owner: 'u1', tool: 'hoe', x: 24, y: 12 }}).then(() => 'ok', e => e.code)")
        check(denied == "not_allowed", "訪客不能用鋤頭（伺服器拒絕，不只是畫面停用）")
        w = B.evaluate(f"{P}.call('tool', {{ owner: 'u1', tool: 'wateringcan', x: 22, y: 12 }})")
        check(w["result"]["ok"], "訪客可以幫忙澆水（主人不必在線上）")

        # ---- 3. 共同耕作：A 邀請 B → B 可以用所有農具；A 即時看到 ----
        A.evaluate(f"{P}.warp('farm', 'door')"); A.wait_for_timeout(600)
        A.evaluate(f"{P}.call('social', {{ coop: 'u2', on: true }})")
        B.wait_for_timeout(1200)
        check(B.evaluate(f"{P}.visits.get('u1').role") == "coop", "B 收到推播：變成共耕夥伴")
        check(not B.evaluate("document.querySelectorAll('#toolbar button')[3].disabled"), "共耕夥伴的鋤頭可以用")
        B.evaluate(f"Object.assign({P}.me, {{x: 24 * 16 + 8, y: 12 * 16 - 3, dir: 0}})")
        B.evaluate(f"(() => {{ delete {P}.visits.get('u1').farm.debris['24,13']; }})()")
        B.evaluate(f"{P}.call('tool', {{ owner: 'u1', tool: 'hoe', x: 24, y: 12 }})")
        planted = B.evaluate(f"{P}.call('tool', {{ owner: 'u1', tool: 'seed', x: 24, y: 12 }})")
        check(planted["result"].get("plant") == "wheat" and planted["seeds"]["wheat"] == 14, "B 在 A 的田播種，種子從 B 扣")
        A.wait_for_timeout(700)
        check(A.evaluate(f"!!{P}.farm.crops['24,12']") and A.evaluate(f"{P}.map.farmObjects.some(o => o.k === 'wheat0' && o.x === 24 * 16 + 8)"),
              "A 即時看到 B 種下的小麥")
        A.wait_for_function("document.getElementById('log').textContent.includes('幫忙')", timeout=6000)
        check("幫忙" in A.inner_text("#log"), "A 收到共耕夥伴幫忙的提示（合併成一則）")
        pa.screenshot(path=str(OUT / "coop.png"))

        # ---- 4. 跳蚤市場 ----
        # 讓 A 有東西可賣：清幾格雜物拿木材／石頭
        got = 0
        for k, d in json.loads(json.dumps(A.evaluate(f"{P}.farm.debris"))).items():
            if got >= 2: break
            x, y = map(int, k.split(","))
            tool = {"weed": "sickle", "stone": "pickaxe", "twig": "axe", "stump": "axe"}[d["t"]]
            for _ in range(d["hp"]):
                A.evaluate(f"{P}.call('tool', {{ tool: '{tool}', x: {x}, y: {y} }})")
            got += 1
        inv = A.evaluate(f"{P}.farm.inv")
        item = next(k for k in ("wood", "stone", "fiber") if inv.get(k))
        A.evaluate(f"{P}.warp('town', 'west')"); A.wait_for_timeout(300)
        A.click("#btn-market"); A.wait_for_timeout(500)
        A.locator("#panel .chips button", has_text="上架").click(); A.wait_for_timeout(200)
        A.select_option("#panel select", item); A.fill("#panel input[aria-label='數量']", "1"); A.fill("#panel input[aria-label='總價']", "35")
        A.locator("#panel button", has_text="上架").last.click(); A.wait_for_timeout(500)
        check("已上架" in A.inner_text("#panel-body"), "A 在市場上架")
        pa.screenshot(path=str(OUT / "market_sell.png"))
        A.click("#panel-close")
        gold_a = A.evaluate(f"{P}.farm.gold")
        # A 下線，B 才買：錢照樣進 A 的帳戶
        pa.close(); B.wait_for_timeout(500)
        B.evaluate(f"{P}.warp('plaza', 'center')")
        B.click("#btn-market"); B.wait_for_timeout(700)
        check("阿派" in B.inner_text("#panel-body"), "B 在市場看到阿派的掛單")
        B.locator("#panel .shop-row button", has_text="購買").first.click(); B.wait_for_timeout(700)
        check("買到" in B.inner_text("#panel-body") and B.evaluate(f"{P}.farm.inv['{item}']") == 1, "B 買下（伺服器扣錢給貨）")
        pb.screenshot(path=str(OUT / "market_buy.png"))
        B.click("#panel-close")
        pa, A = env.device("u1")
        A.wait_for_timeout(600)
        check(A.evaluate(f"{P}.farm.gold") == gold_a + 35, "A 離線時賣出，回來時 35 G 已入帳")
        check(A.inner_text("#mail-badge") not in ("", "0"), "A 的信箱有成交通知")
        A.click("#btn-mail"); A.wait_for_timeout(500)
        check("買下了你的" in A.inner_text("#panel-body"), "信箱顯示誰買了什麼")
        pa.screenshot(path=str(OUT / "mail_sold.png"))
        A.click("#panel-close")

        # ---- 5. 送禮、防偽造 ----
        B.evaluate(f"{P}.warp('plaza', 'center')")
        forged = B.evaluate("window.__plaza.call('gift', { to: 'u1', item: 'pumpkin' }).then(() => 'ok', e => e.code)")
        check(forged == "no_item", "背包沒有的東西送不出去（伺服器檢查）")

        # ---- 6. 釣魚、餵瑞吉、許願 ----
        cast = B.evaluate(f"{P}.call('cast', {{ where: 'sea' }})")
        early = B.evaluate(f"{P}.call('land', {{ cast: {cast['cast']}, ok: true }}).then(() => 'ok', e => e.code)")
        check(early == "bad_timing", "還沒咬鉤就收竿會被伺服器拒絕")
        caught = None
        for _ in range(4):
            c = B.evaluate(f"{P}.call('cast', {{ where: 'sea' }})")
            B.wait_for_timeout(int(c["bite"]) + 1400)
            caught = B.evaluate(f"{P}.call('land', {{ cast: {c['cast']}, ok: true }})")
            if caught["fish"] != "boot": break
        check(caught and caught["caught"], f"釣到 {caught and caught['fish']}（伺服器抽魚、計時）")
        B.evaluate(f"{P}.reload()")
        fish = [k for k in B.evaluate(f"{P}.farm.inv") if k.startswith("fish_")]
        if fish:
            B.evaluate(f"Object.assign({P}.me, {{x: 389, y: 214, dir: 0}})")
            env.key(pb, B, "e"); B.wait_for_timeout(400)
            for _ in range(5):
                if not B.is_visible("#dialog"): break
                env.key(pb, B, "e"); B.wait_for_timeout(250)
            B.wait_for_timeout(600)
            check("瑞吉吃了" in B.inner_text("#toast"), "在劇場前按 E 餵瑞吉，收到回禮")
            pb.screenshot(path=str(OUT / "reggie.png"))
        gold_b = B.evaluate(f"{P}.farm.gold")
        B.evaluate(f"Object.assign({P}.me, {{x: 240, y: 206, dir: 1}})")
        env.key(pb, B, "e"); B.wait_for_timeout(400)
        for _ in range(5):
            if not B.is_visible("#dialog"): break
            env.key(pb, B, "e"); B.wait_for_timeout(250)
        B.wait_for_timeout(600)
        check(B.evaluate(f"{P}.farm.gold") - gold_b in {base + quest for base in (-10, 40) for quest in (0, 20, 80)},
              "在噴水池前許願（扣 10 G，可能得到回應；今日委託剛好是許願時另有 20／+60 G）")
        pb.screenshot(path=str(OUT / "fountain.png"))

        # ---- 7. 伺服器資料 ----
        players = dict(rows(env.db, "SELECT user_id, data FROM plaza_players"))
        check({"u1", "u2"} <= set(players), "玩家資料存在伺服器的 plaza_players")
        check(not [e for e in env.errors if "favicon" not in e], f"console 無錯誤 {env.errors[:3]}")
    if fails:
        print("--- server log ---\n" + env.log[-1500:])
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
