"""派派大作戰：派對競技場的三回合派對秀（伺服器權威模擬）。

純邏輯，不碰網路：PlazaService 每 100ms 呼叫 tick(now)，再把 snapshot() 推給在競技場的人。
真人的位置來自玩家本來就在送的位置訊息（pose），這裡只做限速與限制在場內；
金幣歸屬、派餅命中、地板塌陷、名次全部在這裡算。人不夠時由鎮民 NPC 補位。

回合：
  coin  金幣雨：場上不斷落金幣，碰到就撿（金派 5 分）。
  pie   派餅大戰：朝方向丟派，打中 +1，被打中暈一下。
  floor 落地板：地板一塊塊閃紅後塌陷，掉下去出局，越晚出局名次越高。
"""

from __future__ import annotations

import math
import random
from typing import Any

# ---------- 場地（原生像素，1 格 16 px） ----------
FIELD = (64, 48, 416, 240)                   # x0, y0, x1, y1（和前端 maps/arena.js 一致）
CELL = 32
COLS = (FIELD[2] - FIELD[0]) // CELL         # 11
ROWS = (FIELD[3] - FIELD[1]) // CELL         # 6
DESK = (176, 262)                            # 報名台（場地南邊的大廳）
LOBBY = [(208 + (i % 4) * 22, 252 + (i // 4) * 14) for i in range(8)]   # 散場後站的位置
INSET = 6

SPEED = 64.0                                 # 和前端 logic.js SPEED 一致
BOT_SPEED = 54.0
MIN_PLAYERS = 4
MAX_PLAYERS = 8
QUEUE_MS = 20000
QUEUE_EXTEND_MS = 5000
INTRO_MS = 3500
RESULT_MS = 4000
FINAL_MS = 9000
ROUND_POINTS = [10, 7, 5, 3, 2, 1, 1, 1]
GOLD_BY_RANK = [60, 40, 25]
GOLD_REST = 10
DAILY_PAID = 8
DESK_REACH = 28

COIN = {"ms": 40000, "every": 500, "max": 14, "goldChance": 0.08, "reach": 11, "grace": 400}
FINAL_MULT = 2                                # 決賽回合積分加倍
HUMAN_BONUS = 0.2                             # 每多一位真人同場，金幣 +20%（最多 +100%）
PIE = {"ms": 45000, "ammo": 3, "regen": 1500, "speed": 150.0, "life": 1200, "hit": 10, "stun": 1500, "cool": 350, "shield": 1200}
FLOOR = {"ms": 60000, "warn": 1600, "first": 3000, "gapStart": 2600, "gapEnd": 1300, "kStart": 3, "kEnd": 7,
         "keep": 4, "grace": 250}

PODIUM = [(240, 194), (224, 202), (256, 207)]   # 頒獎台：第一、二、三名站的位置（前端 arenaPodium 底部在 y=222）

ROUND_NAMES = {"coin": "金幣雨", "pie": "派餅大戰", "floor": "落地板"}

# 補位的鎮民：名字與 ninja/npc 走路圖
BOTS = [
    ("npc:sam", "山姆", "villager3"), ("npc:kid", "小傑", "child"), ("npc:robin", "蘿蘋", "cavegirl2"),
    ("npc:mary", "瑪莉", "woman"), ("npc:chubby", "阿胖", "villager4"), ("npc:clint", "克林", "hunter"),
    ("npc:nicole", "妮可", "inspector"),
]


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def in_field(x: float, y: float) -> tuple[float, float]:
    return clamp(x, FIELD[0] + INSET, FIELD[2] - INSET), clamp(y, FIELD[1] + INSET + 4, FIELD[3] - 2)


def cell_of(x: float, y: float) -> int:
    c = int(clamp((x - FIELD[0]) // CELL, 0, COLS - 1))
    r = int(clamp((y - FIELD[1]) // CELL, 0, ROWS - 1))
    return r * COLS + c


def cell_center(i: int) -> tuple[float, float]:
    return FIELD[0] + (i % COLS) * CELL + CELL / 2, FIELD[1] + (i // COLS) * CELL + CELL / 2 + 4


def spawn_points(n: int) -> list[tuple[float, float]]:
    """沿著橢圓平均站好，面向中央。"""
    cx, cy = (FIELD[0] + FIELD[2]) / 2, (FIELD[1] + FIELD[3]) / 2 + 4
    out = []
    for i in range(n):
        a = 2 * math.pi * i / max(1, n) - math.pi / 2
        out.append((round(cx + math.cos(a) * 120), round(cy + math.sin(a) * 62)))
    return out


def rank_points(scores: dict[str, float], order: list[str]) -> dict[str, int]:
    """同分同名次；名次換成積分。"""
    ranked = sorted(order, key=lambda u: -scores.get(u, 0))
    pts: dict[str, int] = {}
    prev_score, prev_rank = None, 0
    for i, uid in enumerate(ranked):
        s = scores.get(uid, 0)
        rank = prev_rank if s == prev_score else i
        pts[uid] = ROUND_POINTS[rank] if rank < len(ROUND_POINTS) else 1
        prev_score, prev_rank = s, rank
    return pts


class Arena:
    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()
        self.events: list[dict[str, Any]] = []
        self.show_id = 0
        self.payout_due: list[dict[str, Any]] | None = None
        self.reset()

    # ---------- 狀態 ----------
    def reset(self) -> None:
        self.phase = "idle"              # idle / queue / intro / live / result / final
        self.phase_end = 0
        self.queue: list[str] = []
        self.p: dict[str, dict[str, Any]] = {}       # 參賽者（含 NPC）
        self.order: list[str] = []
        self.rounds: list[str] = []
        self.rd = -1
        self.kind = ""
        self.started = 0
        self.coins: dict[int, list] = {}
        self.grace: dict[int, list] = {}
        self.pies: list[dict[str, Any]] = []
        self.floor: list[int] = [0] * (COLS * ROWS)
        self.fall_at: dict[int, int] = {}
        self.next_at = 0
        self.seq = 0
        self.results: list[dict[str, Any]] | None = None
        self.payable: list[str] = []

    @property
    def running(self) -> bool:
        return self.phase in ("intro", "live", "result", "final")

    def humans(self) -> list[str]:
        return [u for u in self.order if not self.p[u]["bot"]]

    def _ev(self, **e: Any) -> None:
        self.events.append(e)

    def _player(self, uid: str, name: str, look: Any, bot: bool, sprite: str | None = None) -> dict[str, Any]:
        return {"name": str(name)[:16], "look": look, "bot": bot, "sprite": sprite, "x": DESK[0], "y": DESK[1] - 10,
                "dir": 0, "total": 0, "score": 0, "out": None, "stun": 0, "ammo": PIE["ammo"], "regen": 0, "cool": 0,
                "gone": False, "seen": 0, "tp": 0, "danger": 0, "goal": None, "think": 0, "react": 0, "alarm": 0, "shield": 0}

    # ---------- 玩家操作 ----------
    def join(self, uid: str, name: str, look: Any, x: float, y: float, now: int) -> str | None:
        if self.running:
            return "arena_busy"
        if uid in self.queue:
            return "already_in"
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not math.isfinite(x) or not math.isfinite(y):
            return "bad_message"
        if math.hypot(x - DESK[0], y - DESK[1]) > DESK_REACH:
            return "too_far"
        if len(self.queue) >= MAX_PLAYERS:
            return "arena_full"
        self.queue.append(uid)
        self.p[uid] = self._player(uid, name, look, False)
        self.p[uid]["x"], self.p[uid]["y"], self.p[uid]["seen"] = x, y, now
        if self.phase == "idle":
            self.phase, self.phase_end = "queue", now + QUEUE_MS
        elif self.phase_end - now < QUEUE_EXTEND_MS:
            self.phase_end = now + QUEUE_EXTEND_MS
        if len(self.queue) >= MAX_PLAYERS:
            self.phase_end = now
        self._ev(k="join", id=uid, name=self.p[uid]["name"])
        return None

    def leave(self, uid: str, now: int) -> None:
        if self.phase == "queue" and uid in self.queue:
            self.queue.remove(uid)
            self.p.pop(uid, None)
            self._ev(k="leave", id=uid)
            if not self.queue:
                self.reset()
            return
        pl = self.p.get(uid)
        if pl and not pl["bot"] and not pl["gone"]:
            pl["gone"] = True
            self._ev(k="gone", id=uid)

    def pose(self, uid: str, x: Any, y: Any, now: int) -> None:
        pl = self.p.get(uid)
        if pl is None or pl["bot"]:
            return
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not math.isfinite(x) or not math.isfinite(y):
            return
        dt = clamp((now - (pl["seen"] or now)) / 1000, 0.05, 1.0)
        pl["seen"] = now
        if pl["gone"]:
            return
        if not self.running:
            pl["x"], pl["y"] = float(x), float(y)
            return
        if now < pl["tp"] or pl["out"] is not None or now < pl["stun"] or self.phase == "final":
            return
        x, y = in_field(float(x), float(y))
        dx, dy = x - pl["x"], y - pl["y"]
        dist = math.hypot(dx, dy)
        limit = SPEED * dt * 1.6 + 10
        if dist > limit:                       # 太快：只承認合理的那一段
            x, y = pl["x"] + dx / dist * limit, pl["y"] + dy / dist * limit
        if dist > 0.3:
            pl["dir"] = (3 if dx > 0 else 2) if abs(dx) > abs(dy) else (0 if dy > 0 else 1)
        pl["x"], pl["y"] = x, y

    def throw(self, uid: str, dx: Any, dy: Any, now: int) -> str | None:
        pl = self.p.get(uid)
        if pl is None or pl["gone"] or pl["out"] is not None or self.phase != "live" or self.kind != "pie":
            return "not_live"
        if not isinstance(dx, (int, float)) or not isinstance(dy, (int, float)):
            return "bad_message"
        n = math.hypot(dx, dy)
        if not n or not math.isfinite(n):
            return "bad_message"
        return self._throw(uid, pl, dx / n, dy / n, now)

    def _throw(self, uid: str, pl: dict[str, Any], ux: float, uy: float, now: int) -> str | None:
        if now < pl["stun"]:
            return "stunned"
        if pl["ammo"] <= 0 or now < pl["cool"]:
            return "no_ammo"
        pl["ammo"] -= 1
        pl["cool"] = now + PIE["cool"]
        if pl["regen"] <= now:
            pl["regen"] = now + PIE["regen"]
        self.seq += 1
        self.pies.append({"id": self.seq, "by": uid, "x": pl["x"] + ux * 6, "y": pl["y"] - 6 + uy * 6, "vx": ux * PIE["speed"],
                          "vy": uy * PIE["speed"], "until": now + PIE["life"]})
        pl["dir"] = (3 if ux > 0 else 2) if abs(ux) > abs(uy) else (0 if uy > 0 else 1)
        return None

    # ---------- 流程 ----------
    def _start_show(self, now: int) -> None:
        self.show_id += 1
        self.order = list(self.queue)
        self.queue = []
        free = [b for b in BOTS]
        self.rng.shuffle(free)
        while len(self.order) < MIN_PLAYERS and free:
            bid, name, sprite = free.pop()
            self.p[bid] = self._player(bid, name, None, True, sprite)
            self.order.append(bid)
        for uid in list(self.p):
            if uid not in self.order:
                del self.p[uid]
        first = ["coin", "pie"]
        self.rng.shuffle(first)
        self.rounds = first + ["floor"]
        self.rd = -1
        self.results = None
        self.payable = []
        self._next_round(now)

    def _next_round(self, now: int) -> None:
        self.rd += 1
        self.kind = self.rounds[self.rd]
        self.phase, self.phase_end = "intro", now + INTRO_MS
        self.coins, self.pies, self.fall_at, self.grace = {}, [], {}, {}
        self.floor = [0] * (COLS * ROWS)
        spots = spawn_points(len(self.order))
        self.rng.shuffle(spots)
        for uid, (x, y) in zip(self.order, spots):
            pl = self.p[uid]
            pl.update(x=float(x), y=float(y), score=0, out=None, stun=0, ammo=PIE["ammo"], regen=0, cool=0, danger=0,
                      goal=None, think=0, react=0, alarm=0, shield=0, tp=now + 700)
            self._ev(k="tp", id=uid, x=x, y=y)
        self._ev(k="round", rd=self.rd, kind=self.kind)

    def _go_live(self, now: int) -> None:
        self.phase = "live"
        self.started = now
        self.phase_end = now + {"coin": COIN["ms"], "pie": PIE["ms"], "floor": FLOOR["ms"]}[self.kind]
        self.next_at = now + (FLOOR["first"] if self.kind == "floor" else 0)

    def _end_round(self, now: int) -> None:
        active = [u for u in self.order if not self.p[u]["gone"] or self.p[u]["score"]]
        scores = {u: self.p[u]["score"] for u in self.order}
        if self.kind == "floor":                 # 存活者最高，其餘依出局時間
            for u in self.order:
                out = self.p[u]["out"]
                scores[u] = 10 ** 9 if out is None else out
        pts = rank_points(scores, active or self.order)
        mult = FINAL_MULT if self.rd == len(self.rounds) - 1 else 1
        for u in self.order:                     # 集章用：各回合最好成績
            st = self.p[u].setdefault("stats", {})
            if self.kind == "coin":
                st["coin"] = max(st.get("coin", 0), self.p[u]["score"])
            elif self.kind == "pie":
                st["hit"] = max(st.get("hit", 0), self.p[u]["score"])
            elif self.p[u]["out"] is None and not self.p[u]["gone"]:
                st["survive"] = True
        for u in self.order:
            gain = pts.get(u, 0) * mult if not self.p[u]["gone"] else 0
            self.p[u]["total"] += gain
            self.p[u]["gain"] = gain
        self.pies = []
        self.phase, self.phase_end = "result", now + RESULT_MS
        self._ev(k="result", rd=self.rd)

    def _finish(self, now: int) -> None:
        ranked = sorted(self.order, key=lambda u: (-self.p[u]["total"], self.order.index(u)))
        self.results = []
        for i, u in enumerate(ranked):
            pl = self.p[u]
            self.results.append({"id": u, "name": pl["name"], "total": pl["total"], "rank": i + 1, "bot": pl["bot"]})
        humans = len(self.humans())
        self.payable = [u for u in ranked if not self.p[u]["bot"] and not self.p[u]["gone"]]
        self.mult = min(2.0, 1 + HUMAN_BONUS * max(0, humans - 1))
        for r in self.results:
            r["gold"] = 0 if r["bot"] else int(round(self.gold_for(r["rank"]) * self.mult))
        self.payout_due = [{**r, "stats": dict(self.p[r["id"]].get("stats", {})), "humans": humans}
                           for r in self.results if r["id"] in self.payable]
        self.phase, self.phase_end = "final", now + FINAL_MS
        for i, u in enumerate(ranked):           # 前三名站上頒獎台，其他人排在台前
            x, y = PODIUM[i] if i < len(PODIUM) else (304 + (i - 3) % 3 * 24, 196 + (i - 3) // 3 * 18)
            pl = self.p[u]
            pl.update(x=float(x), y=float(y), out=None, stun=0, dir=0, tp=now + 700)
            self._ev(k="tp", id=u, x=x, y=y)
        self._ev(k="final")

    def _close(self, now: int) -> None:
        for i, uid in enumerate(self.order):
            if not self.p[uid]["bot"]:
                x, y = LOBBY[i % len(LOBBY)]
                self._ev(k="tp", id=uid, x=x, y=y)
        self.reset()

    def gold_for(self, rank: int) -> int:
        return GOLD_BY_RANK[rank - 1] if rank - 1 < len(GOLD_BY_RANK) else GOLD_REST

    def tick(self, now: int, dt: float = 0.1) -> None:
        if self.phase == "idle":
            return
        if self.phase == "queue":
            if now >= self.phase_end:
                self._start_show(now)
            return
        if not [u for u in self.humans() if not self.p[u]["gone"]]:
            self._ev(k="abort")
            self.reset()
            return
        if self.phase == "intro":
            if now >= self.phase_end:
                self._go_live(now)
            return
        if self.phase == "live":
            self._bots(now, dt)
            if self.kind == "coin":
                self._tick_coin(now)
            elif self.kind == "pie":
                self._tick_pie(now, dt)
            else:
                self._tick_floor(now, dt)
            if now >= self.phase_end or (self.kind == "floor" and self._floor_done()):
                self._end_round(now)
            return
        if self.phase == "result" and now >= self.phase_end:
            if self.rd + 1 < len(self.rounds):
                self._next_round(now)
            else:
                self._finish(now)
            return
        if self.phase == "final" and now >= self.phase_end:
            self._close(now)

    # ---------- 金幣雨 ----------
    def _tick_coin(self, now: int) -> None:
        if now >= self.next_at and len(self.coins) < COIN["max"]:
            self.next_at = now + COIN["every"]
            self.seq += 1
            x = self.rng.uniform(FIELD[0] + 14, FIELD[2] - 14)
            y = self.rng.uniform(FIELD[1] + 16, FIELD[3] - 8)
            self.coins[self.seq] = [round(x), round(y), 5 if self.rng.random() < COIN["goldChance"] else 1]
        for cid, (cx, cy, v) in list(self.coins.items()):
            best, bd = None, COIN["reach"]
            for u in self.order:
                pl = self.p[u]
                if pl["gone"] or now < pl["tp"]:
                    continue
                d = math.hypot(pl["x"] - cx, pl["y"] - cy)
                if d <= bd:
                    best, bd = u, d
            if best:
                del self.coins[cid]
                self.p[best]["score"] += v
                self.grace[cid] = [cx, cy, v, now + COIN["grace"], {best}]
                self._ev(k="coin", c=cid, id=best, v=v)
        # 共享拾取窗：別人剛撿走的 0.4 秒內，你也碰到就一樣算（抵消延遲）
        for cid, g in list(self.grace.items()):
            cx, cy, v, until, got = g
            if now > until:
                del self.grace[cid]
                continue
            for u in self.order:
                pl = self.p[u]
                if u in got or pl["bot"] or pl["gone"]:
                    continue
                if math.hypot(pl["x"] - cx, pl["y"] - cy) <= COIN["reach"] + 3:
                    got.add(u)
                    pl["score"] += v
                    self._ev(k="coin", c=cid, id=u, v=v)

    # ---------- 派餅大戰 ----------
    def _tick_pie(self, now: int, dt: float) -> None:
        for u in self.order:
            pl = self.p[u]
            if pl["ammo"] < PIE["ammo"] and now >= pl["regen"]:
                pl["ammo"] += 1
                pl["regen"] = now + PIE["regen"]
        keep = []
        for pie in self.pies:
            pie["x"] += pie["vx"] * dt
            pie["y"] += pie["vy"] * dt
            hit = None
            for u in self.order:
                if u == pie["by"]:
                    continue
                pl = self.p[u]
                if pl["gone"] or now < pl["shield"]:
                    continue
                if math.hypot(pl["x"] - pie["x"], pl["y"] - 6 - pie["y"]) <= PIE["hit"]:
                    hit = u
                    break
            if hit:
                self.p[hit]["stun"] = now + PIE["stun"]
                self.p[hit]["shield"] = now + PIE["stun"] + PIE["shield"]
                if pie["by"] in self.p and not self.p[pie["by"]]["gone"]:
                    self.p[pie["by"]]["score"] += 1
                self._ev(k="hit", id=hit, by=pie["by"], x=round(pie["x"]), y=round(pie["y"]))
                continue
            if now >= pie["until"] or not (FIELD[0] - 8 <= pie["x"] <= FIELD[2] + 8 and FIELD[1] - 16 <= pie["y"] <= FIELD[3] + 8):
                self._ev(k="splat", x=round(pie["x"]), y=round(pie["y"]))
                continue
            keep.append(pie)
        self.pies = keep

    # ---------- 落地板 ----------
    def _floor_gap(self, now: int) -> tuple[int, int]:
        f = clamp((now - self.started) / FLOOR["ms"], 0, 1)
        gap = FLOOR["gapStart"] + (FLOOR["gapEnd"] - FLOOR["gapStart"]) * f
        k = FLOOR["kStart"] + (FLOOR["kEnd"] - FLOOR["kStart"]) * f
        return int(gap), int(round(k))

    def _tick_floor(self, now: int, dt: float) -> None:
        for i, at in list(self.fall_at.items()):
            if now >= at:
                self.floor[i] = 2
                del self.fall_at[i]
        if now >= self.next_at:
            gap, k = self._floor_gap(now)
            self.next_at = now + gap
            solid = [i for i, s in enumerate(self.floor) if s == 0]
            k = min(k, max(0, len(solid) - FLOOR["keep"]))
            if k > 0:
                under = {cell_of(self.p[u]["x"], self.p[u]["y"]) for u in self.order if self.p[u]["out"] is None and not self.p[u]["gone"]}
                pick: list[int] = []
                pref = [i for i in solid if i in under]
                self.rng.shuffle(pref)
                for i in pref[: max(1, k // 2)]:
                    pick.append(i)
                rest = [i for i in solid if i not in pick]
                self.rng.shuffle(rest)
                pick += rest[: k - len(pick)]
                for i in pick:
                    self.floor[i] = 1
                    self.fall_at[i] = now + FLOOR["warn"]
                self._ev(k="crack", cells=pick)
        for u in self.order:
            pl = self.p[u]
            if pl["out"] is not None or pl["gone"] or now < pl["tp"]:
                continue
            if self.floor[cell_of(pl["x"], pl["y"])] == 2:
                pl["danger"] += dt * 1000
                if pl["danger"] >= FLOOR["grace"] or pl["bot"]:
                    pl["out"] = now
                    self._ev(k="fall", id=u, x=round(pl["x"]), y=round(pl["y"]))
            else:
                pl["danger"] = 0

    def _floor_done(self) -> bool:
        alive = [u for u in self.order if self.p[u]["out"] is None and not self.p[u]["gone"]]
        return len(alive) <= 1 and len(self.order) >= 2

    # ---------- NPC ----------
    def _move_bot(self, pl: dict[str, Any], gx: float, gy: float, dt: float) -> None:
        dx, dy = gx - pl["x"], gy - pl["y"]
        d = math.hypot(dx, dy)
        if d < 1:
            return
        step = min(d, BOT_SPEED * dt)
        pl["x"], pl["y"] = in_field(pl["x"] + dx / d * step, pl["y"] + dy / d * step)
        pl["dir"] = (3 if dx > 0 else 2) if abs(dx) > abs(dy) else (0 if dy > 0 else 1)

    def _bots(self, now: int, dt: float) -> None:
        for u in self.order:
            pl = self.p[u]
            if not pl["bot"] or pl["out"] is not None or now < pl["stun"]:
                continue
            if self.kind == "coin":
                self._bot_coin(pl, now, dt)
            elif self.kind == "pie":
                self._bot_pie(u, pl, now, dt)
            else:
                self._bot_floor(pl, now, dt)

    def _bot_coin(self, pl: dict[str, Any], now: int, dt: float) -> None:
        if now >= pl["think"] or (pl["goal"] and pl["goal"][2] not in self.coins):
            pl["think"] = now + self.rng.randint(500, 1100)
            best, bd = None, 1e9
            for cid, (cx, cy, v) in self.coins.items():
                d = math.hypot(cx - pl["x"], cy - pl["y"]) / (2.5 if v > 1 else 1) + self.rng.uniform(0, 40)
                if d < bd:
                    best, bd = (cx, cy, cid), d
            pl["goal"] = best
        if pl["goal"]:
            self._move_bot(pl, pl["goal"][0], pl["goal"][1], dt)

    def _bot_pie(self, uid: str, pl: dict[str, Any], now: int, dt: float) -> None:
        targets = [v for v in self.order if v != uid and not self.p[v]["gone"] and now >= self.p[v]["shield"]]
        if not targets:
            return
        if now >= pl["think"] or not pl["goal"] or pl["goal"][2] not in targets:
            pl["think"] = now + self.rng.randint(900, 1800)
            t = min(targets, key=lambda v: math.hypot(self.p[v]["x"] - pl["x"], self.p[v]["y"] - pl["y"]) + self.rng.uniform(0, 60))
            pl["goal"] = (0, 0, t)
        tp = self.p[pl["goal"][2]]
        dx, dy = tp["x"] - pl["x"], tp["y"] - pl["y"]
        # 對齊一軸再丟：水平距離大就對齊 y，反之對齊 x；保持 60–120 的距離
        if abs(dx) >= abs(dy):
            gx = tp["x"] - math.copysign(90, dx) if abs(dx) < 60 or abs(dx) > 130 else pl["x"]
            gy = tp["y"]
            aligned = abs(dy) < 8 and abs(dx) < 160
            ux, uy = (math.copysign(1, dx), 0.0)
        else:
            gx = tp["x"]
            gy = tp["y"] - math.copysign(70, dy) if abs(dy) < 50 or abs(dy) > 120 else pl["y"]
            aligned = abs(dx) < 8 and abs(dy) < 150
            ux, uy = (0.0, math.copysign(1, dy))
        # 有派朝自己飛來就閃
        for pie in self.pies:
            if pie["by"] == uid:
                continue
            rx, ry = pl["x"] - pie["x"], pl["y"] - 6 - pie["y"]
            if math.hypot(rx, ry) < 60 and rx * pie["vx"] + ry * pie["vy"] > 0 and self.rng.random() < 0.08:
                gx, gy = pl["x"] + (-pie["vy"]) * 0.4, pl["y"] + pie["vx"] * 0.4
        self._move_bot(pl, gx, gy, dt)
        if aligned and now >= pl["react"]:
            pl["react"] = now + self.rng.randint(900, 1900)
            if self.rng.random() < 0.6:
                err = self.rng.uniform(-0.18, 0.18)
                self._throw(uid, pl, ux - uy * err, uy + ux * err, now)

    def _bot_floor(self, pl: dict[str, Any], now: int, dt: float) -> None:
        here = cell_of(pl["x"], pl["y"])
        g = pl["goal"]
        unsafe_goal = g is not None and self.floor[g[2]] != 0
        if self.floor[here] != 0 and (g is None or unsafe_goal):
            if not pl["alarm"]:                            # 看到裂痕要反應一下
                pl["alarm"] = now + self.rng.randint(150, 550)
            if now >= pl["alarm"]:
                solid = [i for i, s in enumerate(self.floor) if s == 0]
                if solid:
                    if self.rng.random() < 0.08:
                        i = self.rng.choice(solid)          # 偶爾慌了，跑去遠的格子
                    else:
                        i = min(solid, key=lambda c: math.hypot(cell_center(c)[0] - pl["x"], cell_center(c)[1] - pl["y"]))
                    pl["goal"] = g = (*cell_center(i), i)
        elif self.floor[here] == 0:
            pl["alarm"] = 0
            if unsafe_goal:
                pl["goal"] = g = None
            if g is None and now >= pl["think"]:
                pl["think"] = now + self.rng.randint(1500, 3000)
                solid = [i for i, s in enumerate(self.floor) if s == 0]
                if solid and self.rng.random() < 0.5:
                    i = self.rng.choice(solid)
                    pl["goal"] = g = (*cell_center(i), i)
        if g:
            self._move_bot(pl, g[0], g[1], dt)
            if math.hypot(g[0] - pl["x"], g[1] - pl["y"]) < 2:
                pl["goal"] = None

    # ---------- 給前端 ----------
    def snapshot(self, now: int) -> dict[str, Any]:
        out: dict[str, Any] = {"ph": self.phase, "end": self.phase_end, "now": now, "id": self.show_id}
        if self.phase == "queue":
            out["q"] = [[u, self.p[u]["name"]] for u in self.queue]
        if self.running:
            out["rd"] = self.rd
            out["kind"] = self.kind
            out["rounds"] = self.rounds
            out["P"] = [[u, pl["name"], round(pl["x"], 1), round(pl["y"], 1), pl["dir"],
                         (1 if pl["bot"] else 0) | (2 if now < pl["stun"] else 0) | (4 if pl["out"] is not None else 0) | (8 if pl["gone"] else 0) | (16 if pl["stun"] <= now < pl["shield"] else 0),
                         pl["score"], pl["total"], pl["ammo"], pl["sprite"] if pl["bot"] else pl["look"], pl.get("gain", 0)]
                        for u, pl in ((u, self.p[u]) for u in self.order)]
            if self.kind == "coin":
                out["C"] = [[cid, c[0], c[1], c[2]] for cid, c in self.coins.items()]
            elif self.kind == "pie":
                out["K"] = [[p["id"], round(p["x"], 1), round(p["y"], 1), round(p["vx"]), round(p["vy"])] for p in self.pies]
            else:
                out["F"] = "".join(str(s) for s in self.floor)
        if self.results is not None:
            out["res"] = self.results
        if self.events:
            out["ev"] = self.events
        return out

    def take_events(self) -> None:
        self.events = []
