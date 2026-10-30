#!/usr/bin/env python3
"""pie-plaza 瀏覽器測試：用假的 SDK（BroadcastChannel）在同一個瀏覽器開兩個分頁互相連線。

用法：python3 tools/pie-plaza/harness.py [輸出目錄]
會截圖、檢查 console 錯誤、檢查兩邊看得到彼此與聊天，失敗時回傳非 0。
"""
import contextlib
import functools
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE = Path(__file__).resolve().parents[2] / "site"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-shots")

STUB_SDK = r"""
const P = window.__PLAYER;
const ch = new BroadcastChannel('plaza-stub');
const rooms = new Map();           // id -> { id, name, private, code, maxPlayers, players: Map }
const handlers = {};
const emit = (e, m) => (handlers[e] || []).forEach((f) => f(m));
const snap = (r) => ({ id: r.id, name: r.name, private: r.private, code: r.code, maxPlayers: r.maxPlayers, playerCount: r.players.size });
let cur = null;
const pub = (r) => ({ ...r, players: [...r.players.values()] });
ch.onmessage = ({ data: m }) => {
  if (m.t === 'hello') { ch.postMessage({ t: 'state', rooms: [...rooms.values()].map((r) => ({ ...r, players: [...r.players.values()] })) }); return; }
  if (m.t === 'state') { for (const r of m.rooms) if (!rooms.has(r.id)) rooms.set(r.id, { ...r, players: new Map(r.players.map((p) => [p.id, p])) }); return; }
  if (m.t === 'create') rooms.set(m.room.id, { ...m.room, players: new Map() });
  if (m.t === 'join') { const r = rooms.get(m.id); if (!r) return; r.players.set(m.player.id, m.player); if (cur === r.id && m.player.id !== P.id) emit('playerJoined', { player: m.player }); }
  if (m.t === 'leave') { const r = rooms.get(m.id); if (!r) return; r.players.delete(m.pid); if (cur === r.id) emit('playerLeft', { playerId: m.pid }); }
  if (m.t === 'msg' && cur === m.id && (m.to == null || m.to === P.id)) emit('message', { from: m.from, data: m.data });
  emit('rooms', { rooms: [...rooms.values()].map(snap) });
};
const client = {
  me: P,
  get room() { return cur ? snap(rooms.get(cur)) : null; },
  on(e, f) { (handlers[e] = handlers[e] || []).push(f); },
  async list() { return [...rooms.values()].map(snap); },
  async create({ maxPlayers, private: pr, name }) {
    const room = { id: 'R' + Math.random().toString(36).slice(2, 8), name, private: pr, code: pr ? 'ABC234' : null, maxPlayers };
    ch.postMessage({ t: 'create', room }); rooms.set(room.id, { ...room, players: new Map() });
    return this.join(room.id);
  },
  async join(id) {
    const r = rooms.get(id) || [...rooms.values()].find((x) => x.code === id);
    if (!r) { const e = new Error('nf'); e.code = 'room_not_found'; throw e; }
    if (r.players.size >= r.maxPlayers) { const e = new Error('full'); e.code = 'room_full'; throw e; }
    cur = r.id; r.players.set(P.id, P);
    ch.postMessage({ t: 'join', id: r.id, player: P });
    emit('joined', { room: snap(r), players: [...r.players.values()] });
  },
  async leave() { if (!cur) return; ch.postMessage({ t: 'leave', id: cur, pid: P.id }); rooms.get(cur).players.delete(P.id); cur = null; },
  send(data, to) { ch.postMessage({ t: 'msg', id: cur, from: P.id, to, data }); },
};
window.__leave = () => client.leave();   // 模擬關閉頁面時伺服器通知離開
export default { ready: async () => ({ user: P }), setHeight() {}, multiplayer: { connect: async () => { ch.postMessage({ t: 'hello' }); await new Promise((r) => setTimeout(r, 300)); return client; } } };
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(Quiet, directory=str(SITE))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/games/community/pie-plaza/index.html"
    errors, fails = [], []

    def check(ok, msg):
        print(("PASS " if ok else "FAIL ") + msg)
        if not ok:
            fails.append(msg)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 760})
        ctx.route("**/sdk/pie-game-sdk.js", lambda r: r.fulfill(body=STUB_SDK, content_type="text/javascript"))
        pages = []
        for i, name in enumerate(["阿派", "小菲"]):
            pg = ctx.new_page()
            pg.add_init_script(f"window.__PLAYER = {json.dumps({'id': 'u%d' % (i + 1), 'username': name, 'displayName': name}, ensure_ascii=False)};")
            pg.on("console", lambda m, n=name: errors.append(f"{n}: {m.text}") if m.type == "error" or (m.type == "warning" and "失敗" in m.text) else None)
            pg.on("pageerror", lambda e, n=name: errors.append(f"{n}: {e}"))
            pg.goto(base)
            pg.wait_for_function("window.__plaza && window.__plaza.ready", timeout=15000)
            pg.evaluate("window.__plaza.setLook([1,2,1,4,1])")
            pg.wait_for_function("document.getElementById('room-info').textContent.includes('人在線')", timeout=15000)
            pages.append(pg)
        a, b = pages
        a.click("#mute"); a.click("#mute")           # 觸發 unlock，載入音效
        a.wait_for_timeout(1500)
        a.wait_for_timeout(600)
        check("2 人在線" in a.inner_text("#room-info"), "A 看到 2 人在線")
        check("2 人在線" in b.inner_text("#room-info"), "B 看到 2 人在線")
        b.wait_for_timeout(300)
        check(b.evaluate("(window.__plaza.people.get('u1') || {}).look") == [1, 2, 1, 4, 1], "B 看到 A 捏好的外觀")
        a.keyboard.down("d"); a.wait_for_timeout(900); a.keyboard.up("d")
        a.keyboard.press("Enter"); a.keyboard.type("大家好，<b>HTML</b> 不會被解析"); a.keyboard.press("Enter")
        b.wait_for_timeout(700)
        log_b = b.inner_text("#log")
        check("大家好" in log_b and "阿派" in log_b, "B 的聊天紀錄收到 A 的話")
        check(b.eval_on_selector("#log", "e => e.querySelector('b') === null"), "聊天內容不會被當成 HTML")
        a.keyboard.press("Enter"); a.keyboard.type("再說一句"); a.keyboard.press("Enter")
        check("說話太快" in a.inner_text("#log"), "連續送出被節流")
        b.click("#world", position={"x": 300, "y": 400}); b.wait_for_timeout(1200)
        a.screenshot(path=str(OUT / "room_a.png")); b.screenshot(path=str(OUT / "room_b.png"))
        a.evaluate("window.__leave()"); a.close(); b.wait_for_timeout(600)
        check("1 人在線" in b.inner_text("#room-info"), "A 關閉頁面後 B 看到 1 人")
        c = ctx.new_page()
        c.add_init_script("window.__PLAYER = {id:'u3',username:'小綠',displayName:'小綠'};")
        c.goto(base)
        c.wait_for_function("window.__plaza && window.__plaza.ready", timeout=15000)
        c.wait_for_function("document.getElementById('room-info').textContent.includes('人在線')", timeout=15000)
        c.wait_for_timeout(500)
        check("2 人在線" in c.inner_text("#room-info"), "第三人進來仍在同一個大廳（不是新房）")
        check(not errors, "console 無錯誤" + ("" if not errors else "：" + "; ".join(errors[:4])))
        browser.close()
    srv.shutdown()
    print(f"截圖在 {OUT}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
