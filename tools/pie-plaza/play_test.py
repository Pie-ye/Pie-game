#!/usr/bin/env python3
"""pie-plaza 互動測試：農場工具、進出門、NPC 對話、小屋樣式、室內裝潢。

用法：python3 tools/pie-plaza/play_test.py [截圖目錄]
"""
import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import STUB_SDK, SITE, Quiet  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-play")
fails = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


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
        pg.wait_for_function("window.__plaza && window.__plaza.map && window.__plaza.area === 'plaza'", timeout=15000)
        pg.wait_for_timeout(600)
        P = "window.__plaza"

        # 0. 第一次進來會先捏臉
        check(pg.is_visible(".creator"), "第一次進來自動開啟捏臉畫面")
        pg.locator(".creator-faces button").nth(5).click()
        pg.locator(".swatches").nth(0).locator("button").nth(9).click()   # 藍髮
        pg.locator(".swatches").nth(2).locator("button").nth(3).click()   # 黃上衣
        pg.locator(".frame").screenshot(path=str(OUT / "creator.png"))
        pg.locator(".creator .primary").click(); pg.wait_for_timeout(200)
        look = pg.evaluate(f"{P}.me.look")
        check(look[:2] == [5, 9] and look[3] == 3, f"捏臉結果套用並存檔 {look}")

        # 1. 從廣場往西走過橋 → 自己的農場
        pg.evaluate(f"Object.assign({P}.me, {{x: 40, y: 150}})")
        pg.keyboard.down("a"); pg.wait_for_timeout(900); pg.keyboard.up("a"); pg.wait_for_timeout(400)
        check(pg.evaluate(f"{P}.area") == "farm:u1", "往西走過橋進入自己的農場")

        # 2. 找一棵雜草，站在它上方、面朝下，用鐮刀
        weed = pg.evaluate(f"Object.entries({P}.farm.debris).find(([k,d]) => d.t==='weed' && !{P}.map.blocked(+k.split(',')[0]*16+8, +k.split(',')[1]*16-4))[0]")
        wx, wy = map(int, weed.split(","))
        before = pg.evaluate(f"Object.keys({P}.farm.debris).length")
        pg.evaluate(f"Object.assign({P}.me, {{x: {wx * 16 + 8}, y: {wy * 16 - 3}, dir: 0}})")
        pg.keyboard.press("3"); pg.keyboard.press(" "); pg.wait_for_timeout(200)
        after = pg.evaluate(f"Object.keys({P}.farm.debris).length")
        check(after == before - 1 and pg.evaluate(f"{P}.farm.inv.fiber") >= 1, "鐮刀割掉雜草並得到纖維")
        check(pg.locator("#inv span").count() >= 1, "背包顯示得到的東西")
        # 翻土、播種、澆水
        pg.keyboard.press("4"); pg.keyboard.press(" "); pg.wait_for_timeout(100)
        pg.keyboard.press("7"); pg.keyboard.press(" "); pg.wait_for_timeout(100)
        pg.keyboard.press("5"); pg.keyboard.press(" "); pg.wait_for_timeout(200)
        crop = pg.evaluate(f"{P}.farm.crops['{wx},{wy}']")
        check(bool(crop) and crop["t"] == "wheat" and crop["w"] > 0, "翻土、種小麥、澆水")
        pg.locator(".frame").screenshot(path=str(OUT / "farm_work.png"))
        # 存檔：重新整理後還在
        pg.reload(); pg.wait_for_function(f"{P} && {P}.farm && {P}.farm.crops['{wx},{wy}']", timeout=15000)
        check(True, "重新整理後農場狀態還在（localStorage）")

        # 2b. 出貨：把剛割的纖維之外，塞一條魚和兩顆小麥進背包再出貨
        pg.evaluate(f"(() => {{ const f = {P}.farm; f.inv.wheat = 2; f.inv.fish_carp = 1; }})()")
        gold0 = pg.evaluate(f"{P}.farm.gold")
        pg.evaluate(f"{P}.warp('farm', 'door')"); pg.wait_for_timeout(300)
        bin_ = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'ship')")
        pg.evaluate(f"Object.assign({P}.me, {{x: {bin_['x']}, y: {bin_['y']} + 13, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        for _ in range(4):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.evaluate(f"{P}.farm.gold") == gold0 + 2 * 25 + 35, "出貨箱把小麥和鯉魚換成金幣")
        check("G" in pg.inner_text("#gold"), "時鐘下方顯示金幣")

        # 2c. 池塘釣魚：面向池塘拋竿 → 咬鉤 → 小遊戲（測試直接讓捕捉條跟著魚）
        pg.evaluate(f"Object.assign({P}.me, {{x: 11 * 16 + 8, y: 23 * 16 + 10, dir: 2}})")
        pg.keyboard.press("6"); pg.keyboard.press(" "); pg.wait_for_timeout(200)
        check(pg.evaluate(f"{P}.fishing && {P}.fishing.phase") == "wait", "面向池塘拋竿")
        pg.evaluate(f"{P}.fishing.until = 0"); pg.wait_for_timeout(150)
        check(pg.evaluate(f"{P}.fishing.phase") == "bite", "魚咬鉤")
        pg.keyboard.press(" "); pg.wait_for_timeout(150)
        check(pg.evaluate(f"{P}.fishing.phase") == "game" and pg.is_visible(".fishing"), "提竿後出現釣魚小遊戲")
        pg.locator(".frame").screenshot(path=str(OUT / "fishing.png"))
        pg.evaluate(f"(() => {{ const g = {P}.fishing.game; g.progress = 0.99; g.bar = Math.max(0, g.fish - g.size / 2); }})()")
        pg.wait_for_timeout(400)
        inv = pg.evaluate(f"{P}.farm.inv")
        check(pg.evaluate(f"{P}.fishing") is None and any(k.startswith("fish_") or True for k in inv), "小遊戲結束")
        check(any(k.startswith("fish_") for k in inv) or "靴子" in pg.inner_text("#toast"), f"釣到魚放進背包 {inv}")

        # 3. 小屋設計告示牌 → 換樣式
        pg.evaluate(f"{P}.warp('farm', 'door')"); pg.wait_for_timeout(300)
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'houseDesign')")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']} + 14, y: {sign['y']}, dir: 2}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(500)
        check(pg.is_visible("#dialog"), "對告示牌按 E 出現對話框")
        for _ in range(4):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "小屋設計" in pg.inner_text("#panel-title"), "對話結束後開啟小屋設計面板")
        pg.locator(".styles button").nth(1).click(); pg.wait_for_timeout(300)
        check(pg.evaluate(f"{P}.decor.style") == "houseWood", "選擇木造農舍後小屋換樣式")
        pg.locator("#panel .swatches").nth(0).locator("button").nth(2).click(); pg.wait_for_timeout(200)
        pg.locator("#panel .swatches").nth(1).locator("button").nth(1).click(); pg.wait_for_timeout(200)
        pg.locator("#panel .yard select").nth(1).select_option("6"); pg.wait_for_timeout(300)
        ext = pg.evaluate(f"{P}.decor.ext")
        check(ext["roof"] == 2 and ext["wall"] == 1 and ext["yard"][1] == 6, f"屋頂藍瓦、白牆、院子盆栽 {ext}")
        check(pg.evaluate(f"{P}.map.objects.some(o => o.k === 'plantN')"), "院子擺設出現在農場")
        pg.locator(".frame").screenshot(path=str(OUT / "house_style.png"))
        pg.click("#panel-close")

        # 4. 走進小屋門
        door = pg.evaluate(f"{P}.map.warps.find(w => w.to.startsWith('house'))")
        pg.evaluate(f"Object.assign({P}.me, {{x: {(door['x0'] + door['x1']) / 2}, y: {door['y1'] + 8}, dir: 1}})")
        pg.keyboard.down("w"); pg.wait_for_timeout(500); pg.keyboard.up("w"); pg.wait_for_timeout(400)
        check(pg.evaluate(f"{P}.area") == "house:u1", "往上走進小屋")

        # 5. 裝潢：數字 8 槌子 → 擺一盆花 → 換地板
        n0 = pg.evaluate(f"{P}.decor.items.length")
        pg.keyboard.press("8"); pg.wait_for_timeout(300)
        check(pg.is_visible("#panel") and "裝潢" in pg.inner_text("#panel-title"), "槌子開啟裝潢面板")
        pg.locator(".grid-items button[data-k=flowerPot]").click()
        box = pg.locator("#world").bounding_box()
        # 房間置中：計算第 (12, 6) 格在畫面上的位置
        cam = pg.evaluate(f"(() => {{ const m = {P}.map; return {{ x: -Math.floor((480 - m.pw) / 2), y: -Math.floor((288 - m.ph) / 2) }}; }})()")
        sx = box["x"] + (12 * 16 + 8 - cam["x"]) / 480 * box["width"]
        sy = box["y"] + (6 * 16 + 8 - cam["y"]) / 288 * box["height"]
        pg.mouse.move(sx, sy); pg.mouse.click(sx, sy); pg.wait_for_timeout(300)
        check(pg.evaluate(f"{P}.decor.items.length") == n0 + 1, "點地板擺上花盆")
        pg.locator(".chips button", has_text="黃石地").click(); pg.wait_for_timeout(300)
        check(pg.evaluate(f"{P}.decor.floor") == "yellow", "換成黃石地板")
        pg.locator(".frame").screenshot(path=str(OUT / "decor.png"))
        pg.locator(".grid-items button[data-k=remove]").click()
        pg.mouse.click(sx, sy); pg.wait_for_timeout(300)
        check(pg.evaluate(f"{P}.decor.items.length") == n0, "拿起模式收回花盆")
        pg.keyboard.press("Escape")

        # 6. 商店街：跟鎮長說話
        pg.evaluate(f"{P}.warp('town', 'west')"); pg.wait_for_timeout(300)
        pg.evaluate(f"(() => {{ const n = {P}.map.npcs.find(n => n.id === 'mayor'); n.wander = 0; n.goal = null; Object.assign({P}.me, {{ x: n.x, y: n.y + 14, dir: 1 }}); }})()")
        pg.keyboard.press("e"); pg.wait_for_timeout(700)
        check(pg.is_visible("#dialog") and "路易斯" in pg.inner_text("#dialog-name"), "按 E 和鎮長對話")
        check(pg.evaluate("document.getElementById('dialog-face').naturalWidth") > 0, "對話框顯示頭像")
        pg.locator(".frame").screenshot(path=str(OUT / "talk.png"))
        for _ in range(8):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(150)
        check(not pg.is_visible("#dialog"), "對話可以一路按完關閉")

        # 6b. 公告欄
        pg.evaluate(f"(() => {{ const s = {P}.map.signs.find(s => s.action === 'events'); Object.assign({P}.me, {{ x: s.x, y: s.y + 14, dir: 1 }}); }})()")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        for _ in range(4):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "公告欄" in pg.inner_text("#panel-title") and pg.locator(".event").count() >= 3, "公告欄列出今天的活動")
        pg.click("#panel-close")
        # 6c. 花祭與早市擺設（直接開啟活動）＋夜晚
        pg.evaluate(f"{P}.setEvents(['market','flower'])"); pg.wait_for_timeout(300)
        pg.evaluate(f"Object.assign({P}.me, {{x: 448, y: 260}})"); pg.wait_for_timeout(300)
        pg.locator(".frame").screenshot(path=str(OUT / "festival.png"))
        sam = pg.evaluate(f"(() => {{ const n = {P}.map.npcs.find(n => n.id === 'sam'); n.wander = 0; n.goal = null; Object.assign({P}.me, {{ x: n.x, y: n.y + 14, dir: 1 }}); return n.name; }})()")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check("八折" in pg.inner_text("#dialog-text") or "特賣" in pg.inner_text("#dialog-text"), "早市時山姆說特賣台詞")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "早市" in pg.inner_text("#panel-title"), "早市攤位打開特價種子店")
        g0 = pg.evaluate(f"{P}.farm.gold"); s0 = pg.evaluate(f"{P}.farm.seeds.tomato || 0")
        pg.locator(".shop-row").nth(3).locator("button", has_text="買 1").click(); pg.wait_for_timeout(200)
        check(pg.evaluate(f"{P}.farm.seeds.tomato") == s0 + 1 and pg.evaluate(f"{P}.farm.gold") == g0 - 24, "八折買到番茄種子（24 G）")
        pg.click("#panel-close")
        pg.evaluate(f"{P}.setEvents([])")

        # 7. 進商店、和店主說話
        w = pg.evaluate(f"{P}.map.warps.find(w => w.to === 'shop:bakery')")
        pg.evaluate(f"Object.assign({P}.me, {{x: {(w['x0'] + w['x1']) / 2}, y: {w['y1'] + 8}, dir: 1}})")
        pg.keyboard.down("w"); pg.wait_for_timeout(500); pg.keyboard.up("w"); pg.wait_for_timeout(400)
        check(pg.evaluate(f"{P}.area") == "shop:bakery", "走進麵包店")
        pg.evaluate(f"(() => {{ const n = {P}.map.npcs[0]; Object.assign({P}.me, {{ x: n.x, y: n.y + 30, dir: 1 }}); }})()")
        pg.keyboard.press("e"); pg.wait_for_timeout(500)
        check(pg.is_visible("#dialog") and "瑪莉" in pg.inner_text("#dialog-name"), "隔著櫃台和麵包店老闆對話")
        b.close()
    srv.shutdown()
    check(not errors, "console 無錯誤" + ("" if not errors else "：" + "; ".join(errors[:3])))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
