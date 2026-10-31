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

        # 0. 試玩模式（假 SDK 沒有伺服器遊戲邏輯）：從左下角打開捏臉
        check("試玩" in pg.inner_text("#room-info") or "試玩" in pg.inner_text("#cloud"), "沒有伺服器時是試玩模式")
        pg.click("#btn-look"); pg.wait_for_timeout(300)
        check(pg.is_visible(".creator"), "左下角可以打開捏臉畫面")
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
        # 試玩不存檔：重新整理就回到新農場（正式的存檔在伺服器，見 server_e2e.py）
        pg.reload(); pg.wait_for_function(f"{P} && {P}.ready", timeout=15000); pg.wait_for_timeout(300)
        check(not pg.evaluate(f"{P}.farm.crops['{wx},{wy}']"), "試玩模式不存檔，重新整理就重來")

        # 2b. 出貨：試玩沙盒裡塞兩顆小麥和一條魚再出貨
        pg.evaluate(f"(async () => {{ await {P}.call('sandboxGive', {{ item: 'wheat', n: 2 }}); await {P}.call('sandboxGive', {{ item: 'fish_carp', n: 1 }}); await {P}.reload(); }})()")
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
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(150)

        # 8. 派派鎮民交易所：妮可、五檔行情、訪客不能買
        pg.evaluate(f"{P}.warp('shop:exchange', 'door')"); pg.wait_for_timeout(400)
        check(pg.evaluate(f"{P}.area") == "shop:exchange", "走進派派鎮民交易所")
        pg.evaluate(f"(() => {{ const n = {P}.map.npcs[0]; Object.assign({P}.me, {{ x: n.x, y: n.y + 30, dir: 1 }}); }})()")
        pg.keyboard.press("e"); pg.wait_for_timeout(500)
        check(pg.is_visible("#dialog") and "妮可" in pg.inner_text("#dialog-name"), "隔著櫃台和妮可對話")
        check(pg.evaluate("document.getElementById('dialog-face').naturalWidth") > 0, "妮可頭像載入")
        for _ in range(8):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "交易所" in pg.inner_text("#panel-title"), "對話結束後開啟交易所面板")
        body = pg.inner_text("#panel-body")
        check("GROC" in body and "BAKE" in body and "SHOW" in body and "WISH" in body and "FISH" in body, "五檔指數都列出來")
        check(pg.locator("#panel-body button", has_text="買").first.is_disabled(), "訪客不能買賣")
        pg.locator(".frame").screenshot(path=str(OUT / "exchange.png"))
        pg.click("#panel-close")

        # 9. 廣場搶寶：從廣場走到北邊寶箱，打開派對面板
        pg.evaluate(f"{P}.warp('plaza', 'center')"); pg.wait_for_timeout(400)
        check(pg.evaluate(f"{P}.area") == "plaza", "回到廣場")
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'party')")
        check(bool(sign) and sign.get("title") == "廣場搶寶", "廣場有搶寶告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "廣場搶寶" in pg.inner_text("#dialog-name"), "對寶箱按 E 出現搶寶對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "廣場搶寶" in pg.inner_text("#panel-title"), "對話結束後開啟搶寶面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("開搶" in body or "倒數" in body or "進行" in body or "件" in body, "加入後回合開始")
        vis = pg.evaluate(
            """() => {
              const p = window.__plaza;
              const marks = (p.marks && p.marks()) || [];
              const a = marks.some(m => Math.abs(m.x - 180) < 1 && Math.abs(m.y - 106) < 1);
              const b = marks.some(m => Math.abs(m.x - 228) < 1 && Math.abs(m.y - 106) < 1);
              return { ok: !!(p.party && p.party.status === 'live' && a && b), a, b, status: p.party && p.party.status };
            }"""
        )
        check(bool(vis) and vis.get("ok"), "搶寶世界未拿走的箱子在開場後亮標記")
        pg.locator(".frame").screenshot(path=str(OUT / "party.png"))
        pg.click("#panel-close")

        # 10. 釣魚大賽記分板
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'contest')")
        check(bool(sign) and sign.get("title") == "釣魚大賽", "廣場有釣魚大賽告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} - 14, dir: 0}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "釣魚大賽" in pg.inner_text("#dialog-name"), "對記分板按 E 出現大賽對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "釣魚大賽" in pg.inner_text("#panel-title"), "對話結束後開啟大賽記分板")
        body = pg.inner_text("#panel-body")
        check("記分板" in body or "公分" in body or "時段" in body, "記分板說明大賽規則")
        pg.locator(".frame").screenshot(path=str(OUT / "contest.png"))
        pg.click("#panel-close")

        # 11. 營火捉迷藏：西南草地圓木
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'seek')")
        check(bool(sign) and sign.get("title") == "營火捉迷藏", "廣場有捉迷藏告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "營火捉迷藏" in pg.inner_text("#dialog-name"), "對圓木按 E 出現捉迷藏對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "營火捉迷藏" in pg.inner_text("#panel-title"), "對話結束後開啟捉迷藏面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("尋人" in body or "倒數" in body or "藏" in body, "加入後捉迷藏開始")
        vis = pg.evaluate(
            """() => {
              const p = window.__plaza, s = p.seek;
              const marks = (p.marks && p.marks()) || [];
              const hit = marks.some(m => Math.abs(m.x - 140) < 1 && Math.abs(m.y - 214) < 1);
              const hide = marks.some(m => Math.abs(m.x - 196) < 1 && Math.abs(m.y - 184) < 1);
              return { ok: !!(s && s.status === 'live' && hit && !hide), status: s && s.status, hit, hide };
            }"""
        )
        check(bool(vis) and vis.get("ok"), "捉迷藏世界圓木在開場後亮標記且不爆藏點")
        pg.locator(".frame").screenshot(path=str(OUT / "seek.png"))
        pg.click("#panel-close")

        # 12. 傳南瓜：雞舍旁邊
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'hot')")
        check(bool(sign) and sign.get("title") == "傳南瓜", "廣場有傳南瓜告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "傳南瓜" in pg.inner_text("#dialog-name"), "對南瓜按 E 出現傳南瓜對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "傳南瓜" in pg.inner_text("#panel-title"), "對話結束後開啟傳南瓜面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("南瓜" in body or "倒數" in body or "拿著" in body, "加入後傳南瓜開始")
        vis = pg.evaluate(
            """() => {
              const p = window.__plaza, h = p.hot;
              const o = p.map.objects.find(o => o.k === 'pumpkinItem' && o.x === 128 && o.y === 100);
              const marks = (p.marks && p.marks()) || [];
              const hit = marks.some(m => Math.abs(m.x - 128) < 1 && Math.abs(m.y - 100) < 1);
              return { ok: !!(h && h.status === 'live' && h.holder && (hit || (o && o.z))), holder: h && h.holder, hit, z: o && o.z };
            }"""
        )
        check(bool(vis) and vis.get("ok"), "傳南瓜世界南瓜在有人拿時會跳或亮標記")
        pg.locator(".frame").screenshot(path=str(OUT / "hot.png"))
        pg.click("#panel-close")

        # 13. 廣場拔河：東邊草地乾草
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'tug')")
        check(bool(sign) and sign.get("title") == "廣場拔河", "廣場有拔河告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "廣場拔河" in pg.inner_text("#dialog-name"), "對乾草按 E 出現拔河對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "廣場拔河" in pg.inner_text("#panel-title"), "對話結束後開啟拔河面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("岸" in body or "拉" in body or "倒數" in body, "加入後拔河開始")
        vis = pg.evaluate(
            """() => {
              const p = window.__plaza, t = p.tug;
              const marks = (p.marks && p.marks()) || [];
              const L = marks.some(m => Math.abs(m.x - 328) < 1 && Math.abs(m.y - 180) < 1);
              const R = marks.some(m => Math.abs(m.x - 392) < 1 && Math.abs(m.y - 180) < 1);
              return { ok: !!(t && t.status === 'live' && L && R), L, R, status: t && t.status };
            }"""
        )
        check(bool(vis) and vis.get("ok"), "拔河世界兩岸乾草在開場後亮標記")
        pg.locator(".frame").screenshot(path=str(OUT / "tug.png"))
        pg.click("#panel-close")

        # 14. 廣場搬寶：西邊木桶
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'haul')")
        check(bool(sign) and sign.get("title") == "廣場搬寶", "廣場有搬寶告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "廣場搬寶" in pg.inner_text("#dialog-name"), "對木桶按 E 出現搬寶對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "廣場搬寶" in pg.inner_text("#panel-title"), "對話結束後開啟搬寶面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("木桶" in body or "大鍋" in body or "倒數" in body or "扛" in body, "加入後搬寶開始")
        vis = pg.evaluate(
            """() => {
              const p = window.__plaza, h = p.haul;
              const o = p.map.objects.find(o => o.k === 'barrel' && o.x === 104 && o.y === 168);
              const marks = (p.marks && p.marks()) || [];
              const hit = marks.some(m => Math.abs(m.x - 104) < 1 && Math.abs(m.y - 168) < 1);
              return { ok: !!(h && h.status === 'live' && h.holder && (hit || (o && o.z))), holder: h && h.holder, hit, z: o && o.z };
            }"""
        )
        check(bool(vis) and vis.get("ok"), "搬寶世界木桶在有人扛時會跳或亮標記")
        pg.locator(".frame").screenshot(path=str(OUT / "haul.png"))
        pg.click("#panel-close")

        # 15. 廣場紅綠燈：北邊欄杆
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'light')")
        check(bool(sign) and sign.get("title") == "廣場紅綠燈", "廣場有紅綠燈告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "廣場紅綠燈" in pg.inner_text("#dialog-name"), "對欄杆按 E 出現紅綠燈對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "廣場紅綠燈" in pg.inner_text("#panel-title"), "對話結束後開啟紅綠燈面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("綠燈" in body or "紅燈" in body or "樁" in body or "倒數" in body, "加入後紅綠燈開始")
        pg.locator(".frame").screenshot(path=str(OUT / "light.png"))
        pg.click("#panel-close")

        # 16. 廣場占席：東北草席
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'hill')")
        check(bool(sign) and sign.get("title") == "廣場占席", "廣場有占席告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "廣場占席" in pg.inner_text("#dialog-name"), "對草席按 E 出現占席對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "廣場占席" in pg.inner_text("#panel-title"), "對話結束後開啟占席面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("草席" in body or "占" in body or "倒數" in body, "加入後占席開始")
        vis = pg.evaluate(
            """() => {
              const p = window.__plaza, h = p.hill;
              const marks = (p.marks && p.marks()) || [];
              const hit = marks.some(m => Math.abs(m.x - 424) < 1 && Math.abs(m.y - 56) < 1);
              return { ok: !!(h && h.status === 'live' && h.holder && hit), holder: h && h.holder, n: marks.length };
            }"""
        )
        check(bool(vis) and vis.get("ok"), "占席世界草席在有人占時亮標記")
        pg.locator(".frame").screenshot(path=str(OUT / "hill.png"))
        pg.click("#panel-close")

        # 17. 廣場砸罐：南岸紅罐
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'smash')")
        check(bool(sign) and sign.get("title") == "廣場砸罐", "廣場有砸罐告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "廣場砸罐" in pg.inner_text("#dialog-name"), "對紅罐按 E 出現砸罐對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "廣場砸罐" in pg.inner_text("#panel-title"), "對話結束後開啟砸罐面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("罐" in body or "砸" in body or "倒數" in body, "加入後砸罐開始")
        check("冒出來" in body or "縮回去" in body, "砸罐面板顯示罐子節奏")
        vis = pg.evaluate(
            """() => {
              const p = window.__plaza, s = p.smash;
              const jar = p.map.objects.find(o => o.k === 'jarRed' && o.x === 312 && o.y === 256);
              if (!s || s.status !== 'live' || !jar) return { ok: false, status: s && s.status };
              const t = Math.max(0, Date.now() - (s.startedAt || 0));
              const up = (t % ((s.upMs || 1800) + (s.downMs || 1200))) < (s.upMs || 1800);
              return { ok: (!!jar.hide) === (!up), hide: !!jar.hide, up };
            }"""
        )
        check(bool(vis) and vis.get("ok"), "砸罐世界罐子隨節奏隱藏")
        pg.locator(".frame").screenshot(path=str(OUT / "smash.png"))
        pg.click("#panel-close")

        # 18. 廣場搶瓶：東岸花瓶
        sign = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'vase')")
        check(bool(sign) and sign.get("title") == "廣場搶瓶", "廣場有搶瓶告示")
        pg.evaluate(f"Object.assign({P}.me, {{x: {sign['x']}, y: {sign['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        check(pg.is_visible("#dialog") and "廣場搶瓶" in pg.inner_text("#dialog-name"), "對花瓶按 E 出現搶瓶對話")
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "廣場搶瓶" in pg.inner_text("#panel-title"), "對話結束後開啟搶瓶面板")
        pg.locator("#panel-body button", has_text="加入").click(); pg.wait_for_timeout(400)
        body = pg.inner_text("#panel-body")
        check("小傑" in body and "艾芙琳奶奶" in body, "訪客沙盒自動補兩個 NPC 湊局")
        check("瓶" in body or "隊" in body or "倒數" in body, "加入後搶瓶開始")
        vis = pg.evaluate(
            """() => {
              const p = window.__plaza, h = p.vase;
              const o = p.map.objects.find(o => o.k === 'vase' && o.x === 440 && o.y === 200);
              const marks = (p.marks && p.marks()) || [];
              const hit = marks.some(m => Math.abs(m.x - 440) < 1 && Math.abs(m.y - 200) < 1);
              return { ok: !!(h && h.status === 'live' && h.holder && (hit || (o && o.z))), holder: h && h.holder, hit, z: o && o.z };
            }"""
        )
        check(bool(vis) and vis.get("ok"), "搶瓶世界花瓶在有人拿時會跳或亮標記")
        pg.locator(".frame").screenshot(path=str(OUT / "vase.png"))
        pg.click("#panel-close")

        # 19. 公告欄列出常駐派對
        board = pg.evaluate(f"{P}.map.signs.find(s => s.action === 'events')")
        check(bool(board) and any("搶瓶" in ln for ln in board.get("lines") or []), "公告欄文案提到搶瓶")
        pg.evaluate(f"Object.assign({P}.me, {{x: {board['x']}, y: {board['y']} + 14, dir: 1}})")
        pg.keyboard.press("e"); pg.wait_for_timeout(400)
        for _ in range(6):
            if not pg.is_visible("#dialog"): break
            pg.keyboard.press("e"); pg.wait_for_timeout(250)
        check(pg.is_visible("#panel") and "公告欄" in pg.inner_text("#panel-title"), "對話結束後開啟公告欄")
        body = pg.inner_text("#panel-body")
        check("搶寶" in body and "捉迷藏" in body and "傳南瓜" in body and "拔河" in body and "搬寶" in body and "紅綠燈" in body and "占席" in body and "砸罐" in body and "搶瓶" in body, "公告欄列出九個常駐派對")
        check("進行中" in body or "剛結束" in body, "公告欄標出已開場的常駐人數")
        pg.locator(".frame").screenshot(path=str(OUT / "bulletin.png"))
        pg.click("#panel-close")
        b.close()
    srv.shutdown()
    check(not errors, "console 無錯誤" + ("" if not errors else "：" + "; ".join(errors[:3])))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
