#!/usr/bin/env python3
"""派派大作戰端到端測試：真的伺服器、兩個帳號。

A 走進競技場報名 → B 在廣場收到全鎮公告、點公告過去加入 → NPC 補位 → 三回合（各截圖）→ 頒獎 → 金幣入帳、戰績寫進資料庫。
整場照真實時間跑，約 3 分鐘。
用法：python3 tools/pie-plaza/arena_e2e.py [截圖目錄]
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_env import E2E  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/plaza-arena")
P = "window.__plaza"
fails = []

# 自動玩家：金幣雨走向最近的金幣、派餅戰朝最近的人丟、落地板躲到最近的完好格子
BOT_JS = """
(() => {
  if (window.__autoplay) return;
  const P = window.__plaza;
  window.__autoplay = setInterval(() => {
    const a = P.arena, s = a.snap, me = P.me;
    if (!s || !a.inShow() || s.ph !== 'live' || a.frozen()) return;
    const step = (gx, gy) => { gx = Math.max(72, Math.min(408, gx)); gy = Math.max(60, Math.min(236, gy)); const dx = gx - me.x, dy = gy - me.y, d = Math.hypot(dx, dy); if (d < 1) return; const k = Math.min(d, 6) / d; me.x += dx * k; me.y += dy * k; me.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 2) : (dy > 0 ? 0 : 1); };
    if (s.kind === 'coin' && s.C && s.C.length) {
      const c = s.C.reduce((b, c) => (Math.hypot(c[1] - me.x, c[2] - me.y) < Math.hypot(b[1] - me.x, b[2] - me.y) ? c : b));
      step(c[1], c[2]);
    } else if (s.kind === 'pie') {
      const o = [...a.others.values()].sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y))[0];
      if (o) { step(o.x - 60, o.y); if (Math.abs(o.y - me.y) < 10 && Math.random() < 0.3) P.call('arena', { act: 'throw', dx: Math.sign(o.x - me.x) || 1, dy: 0 }).catch(() => {}); }
    } else if (s.kind === 'floor' && s.F) {
      const [x0, y0] = [64, 48];
      let best = null, bd = 1e9;
      for (let i = 0; i < s.F.length; i++) if (s.F[i] === '0') { const cx = x0 + (i % 11) * 32 + 16, cy = y0 + Math.floor(i / 11) * 32 + 20, d = Math.hypot(cx - me.x, cy - me.y); if (d < bd) { bd = d; best = [cx, cy]; } }
      const here = s.F[a.cellOf(me.x, me.y)];
      if (best && here !== '0') step(best[0], best[1]);
    }
  }, 100);
})();
"""


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        fails.append(msg)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with E2E() as env:
        pa, A = env.device("u1", look=[2, 1, 1, 2, 1])
        pb, B = env.device("u2", look=[6, 3, 2, 5, 2])
        gold0 = A.evaluate(f"{P}.farm.gold")
        A.evaluate(f"{P}.warp('plaza', 'center')")
        B.evaluate(f"{P}.warp('plaza', 'center')")
        A.wait_for_timeout(400)
        # A 從廣場北橋走進競技場
        A.evaluate(f"Object.assign({P}.me, {{x: 240, y: 14, dir: 1}})")
        A.evaluate("window.focus()"); pa.keyboard.down("w"); A.wait_for_timeout(500); pa.keyboard.up("w"); A.wait_for_timeout(700)
        check(A.evaluate(f"{P}.area") == "arena", "A 從廣場北橋走進派對競技場")
        A.locator(".frame").screenshot(path=str(OUT / "00_arena_idle.png"))
        # 走到報名台按 E
        A.evaluate(f"Object.assign({P}.me, {{x: 176, y: 246, dir: 0}})")
        A.wait_for_timeout(300)
        env.key(pa, A, "e"); A.wait_for_timeout(800)
        snap = A.evaluate(f"{P}.arena.snap")
        check(snap and snap["ph"] == "queue" and snap["q"][0][0] == "u1", "A 在報名台按 E：進入報名倒數")
        A.locator(".frame").screenshot(path=str(OUT / "01_queue.png"))
        # B 在廣場看到全鎮公告，點公告過去
        B.wait_for_selector(".arena-call:not([hidden])", timeout=5000)
        check("派派大作戰" in B.inner_text(".arena-call"), "B 在廣場收到全鎮公告")
        B.locator(".frame").screenshot(path=str(OUT / "02_call_in_plaza.png"))
        B.locator(".arena-call").click(); B.wait_for_timeout(800)
        check(B.evaluate(f"{P}.area") == "arena", "B 點公告直接到競技場")
        B.evaluate(f"Object.assign({P}.me, {{x: 176, y: 246, dir: 0}})"); B.wait_for_timeout(300)
        env.key(pb, B, "e"); B.wait_for_timeout(800)
        check(len(A.evaluate(f"{P}.arena.snap.q")) == 2, "B 也報名：兩人在隊伍裡")
        for fr in (A, B):
            fr.evaluate(BOT_JS)
        # 開賽：NPC 補到 4 人
        A.wait_for_function(f"{P}.arena.snap && {P}.arena.snap.ph === 'intro'", timeout=30000)
        n = A.evaluate(f"{P}.arena.snap.P.length")
        bots = A.evaluate(f"{P}.arena.snap.P.filter((r) => r[5] & 1).length")
        check(n == 4 and bots == 2, f"開賽：兩位真人＋兩位鎮民（{n} 人，鎮民 {bots}）")
        check(A.evaluate(f"(() => {{ const m = {P}.me; return m.x > 64 && m.x < 416 && m.y > 48 && m.y < 240; }})()"), "A 被傳送進場地")
        A.locator(".frame").screenshot(path=str(OUT / "03_intro.png"))
        shots = set()
        t0 = time.time()
        while time.time() - t0 < 240:
            s = A.evaluate(f"{P}.arena.snap")
            if not s:
                break
            key = f"{s.get('rd')}_{s['ph']}"
            if s["ph"] == "live" and key not in shots and s.get("end", 0) - s.get("now", 0) < 25000:
                shots.add(key)
                A.locator(".frame").screenshot(path=str(OUT / f"1{s['rd']}_live_{s['kind']}.png"))
                B.locator(".frame").screenshot(path=str(OUT / f"1{s['rd']}_live_{s['kind']}_B.png"))
            if s["ph"] in ("result", "final") and key not in shots:
                A.wait_for_timeout(500)
                shots.add(key)
                A.locator(".frame").screenshot(path=str(OUT / f"2{s.get('rd', 9)}_{s['ph']}.png"))
            if s["ph"] == "idle" and "final" in "".join(shots):
                break
            A.wait_for_timeout(400)
        check(any(k.endswith("final") for k in shots), "三回合打完進入頒獎")
        kinds = A.evaluate(f"{P}.arena.snap && {P}.arena.snap.ph")
        A.wait_for_timeout(1500)
        check(A.evaluate(f"{P}.arena.snap.ph") == "idle", "頒獎後回到等待報名")
        check(A.evaluate(f"{P}.me.y") > 240, "散場後 A 被送回大廳")
        A.locator(".frame").screenshot(path=str(OUT / "30_after.png"))
        gold1 = A.evaluate(f"{P}.farm.gold")
        check(gold1 > gold0, f"A 拿到金幣（{gold0} → {gold1}）")
        con = sqlite3.connect(env.db)
        for uid in ("u1", "u2"):
            data = json.loads(con.execute("SELECT data FROM plaza_players WHERE user_id=?", (uid,)).fetchone()[0])
            st = data.get("arena") or {}
            check(st.get("shows") == 1 and st.get("paid") == 1, f"{uid} 戰績寫進資料庫：{st}")
        con.close()
        errs = [e for e in env.errors if "favicon" not in e]
        check(not errs, f"沒有前端錯誤 {errs[:3]}")
    print("FAILED" if fails else "ALL PASS", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
