"""大胃王蛙：每小時 30 分闖進廣場的世界頭目（伺服器權威模擬，PlazaService 每 100ms 呼叫 tick）。

牠是來偷吃派的。全鎮一起把派丟進牠嘴裡，把肚子餵飽，牠就會睡著、留下禮物離開。不是打架，是餵食。
- 平常身體被打中算 1，張嘴時丟進嘴裡算 3。
- 牠會跳到別處（落點先出現影子，落地時壓到的人暈一下）和呱呱叫（先鼓起來，震波範圍內的人暈一下）。
- 三位鎮民會來幫忙丟派；人越多，牠的肚子越大。
位置用玩家在廣場送出的位置訊息（pose）。
"""

from __future__ import annotations

import math
import os
import random
from typing import Any

# 排程：台北時間每小時 MINUTE 分出現，停留 STAY_MS；WARN_MS 前全鎮預告
MINUTE = int(os.environ.get("PG_BOSS_MINUTE", "30")) % 60    # 測試可用環境變數改
STAY_MS = 6 * 60_000
WARN_MS = 5 * 60_000
TZ = 8 * 3600_000

# 廣場可以落地的位置（避開噴水池與海）
SPOTS = [(240, 104), (128, 150), (352, 150), (176, 236), (304, 236), (240, 150)]
BODY_R = 24          # 身體半徑（中心在腳底往上 24）
MOUTH_BONUS = 3
NEED_BASE = 360
NEED_PER_HUMAN = 150
PIE = {"ammo": 3, "regen": 1200, "speed": 150.0, "life": 1300, "cool": 300}
STUN_MS = 1600
SQUASH_R = 34
CROAK_R = 72
PHASES = {"idle": 2200, "mouth": 3000, "jumpWarn": 1400, "jump": 500, "croakWarn": 1600, "croak": 400, "sleep": 7000, "leave": 2500}
HELPERS = [("npc:sam", "山姆", "villager3"), ("npc:mary", "瑪莉", "woman"), ("npc:kid", "小傑", "child")]
HELPER_SPOTS = [(150, 200), (330, 200), (240, 250)]
GOLD_BASE = 20
GOLD_PER_HIT = 1
GOLD_MAX_HITS = 40
CONSOLATION = 10
DAILY_REWARDS = 6            # 每人每天前 6 次有獎金與禮物


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def window(now_ms: int) -> tuple[int, int]:
    """這個小時的出現時間與離開時間（ms）。"""
    t = now_ms + TZ
    hour0 = t - t % 3_600_000
    start = hour0 + MINUTE * 60_000 - TZ
    return start, start + STAY_MS


def next_start(now_ms: int) -> int:
    start, end = window(now_ms)
    return start if now_ms < end else start + 3_600_000


class Boss:
    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()
        self.events: list[dict[str, Any]] = []
        self.reward_due: list[dict[str, Any]] | None = None
        self.reset()

    def reset(self) -> None:
        self.active = False
        self.phase = "gone"
        self.phase_end = 0
        self.until = 0
        self.x, self.y = SPOTS[0]
        self.target: tuple[float, float] | None = None
        self.need = NEED_BASE
        self.fed = 0
        self.fans: dict[str, dict[str, Any]] = {}      # 丟過派的真人
        self.p: dict[str, dict[str, Any]] = {}         # 在廣場的人（含幫忙的鎮民）
        self.pies: list[dict[str, Any]] = []
        self.seq = 0
        self.result: str | None = None
        self.start_at = 0

    def _ev(self, **e: Any) -> None:
        self.events.append(e)

    def take_events(self) -> None:
        self.events = []

    # ---------- 生命週期 ----------
    def start(self, now: int, until: int, humans: int) -> None:
        self.reset()
        self.active = True
        self.start_at = now
        self.until = until
        self.x, self.y = self.rng.choice(SPOTS[:3])
        self.need = NEED_BASE + NEED_PER_HUMAN * max(0, humans - 1)
        self._phase("idle", now)
        for (hid, name, sprite), (hx, hy) in zip(HELPERS, HELPER_SPOTS):
            self.p[hid] = self._person(name, True, sprite, hx, hy, now)
        self._ev(k="arrive")

    def _person(self, name: str, bot: bool, sprite: str | None, x: float, y: float, now: int) -> dict[str, Any]:
        return {"name": str(name)[:16], "bot": bot, "sprite": sprite, "x": float(x), "y": float(y), "dir": 1, "seen": now,
                "stun": 0, "ammo": PIE["ammo"], "regen": 0, "cool": 0, "react": 0, "goal": None, "think": 0}

    def _phase(self, name: str, now: int) -> None:
        self.phase = name
        self.phase_end = now + PHASES.get(name, 2000)

    def _scale_need(self) -> None:
        humans = len(self.fans)
        self.need = max(self.need, NEED_BASE + NEED_PER_HUMAN * max(0, humans - 1))

    # ---------- 玩家 ----------
    def pose(self, uid: str, name: str, x: Any, y: Any, now: int) -> None:
        if not self.active or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            return
        if not math.isfinite(x) or not math.isfinite(y):
            return
        pl = self.p.get(uid)
        if pl is None:
            if len(self.p) >= 40:
                return
            pl = self.p[uid] = self._person(name, False, None, x, y, now)
        if now < pl["stun"]:
            pl["seen"] = now
            return
        dt = clamp((now - pl["seen"]) / 1000, 0.05, 1.0)
        dx, dy = float(x) - pl["x"], float(y) - pl["y"]
        dist = math.hypot(dx, dy)
        limit = 64 * dt * 1.6 + 10
        if dist > limit and dist < 200:
            x, y = pl["x"] + dx / dist * limit, pl["y"] + dy / dist * limit
        pl["x"], pl["y"], pl["seen"] = float(x), float(y), now

    def leave(self, uid: str) -> None:
        if uid in self.p and not self.p[uid]["bot"]:
            del self.p[uid]

    def throw(self, uid: str, name: str, dx: Any, dy: Any, now: int, kind: str | None = None) -> str | None:
        if not self.active or self.phase in ("sleep", "leave"):
            return "not_live"
        pl = self.p.get(uid)
        if pl is None:
            return "too_far"
        if not isinstance(dx, (int, float)) or not isinstance(dy, (int, float)):
            return "bad_message"
        n = math.hypot(dx, dy)
        if not n or not math.isfinite(n):
            return "bad_message"
        err = self._throw(uid, pl, dx / n, dy / n, now, kind)
        if err is None and not pl["bot"]:
            fan = self.fans.setdefault(uid, {"name": str(name)[:16], "hits": 0, "throws": 0, "fed": 0})
            fan["throws"] += 1
            self._scale_need()
        return err

    def _throw(self, uid: str, pl: dict[str, Any], ux: float, uy: float, now: int, kind: str | None = None) -> str | None:
        if now < pl["stun"]:
            return "stunned"
        if pl["ammo"] <= 0 or now < pl["cool"]:
            return "no_ammo"
        pl["ammo"] -= 1
        pl["cool"] = now + PIE["cool"]
        if pl["regen"] <= now:
            pl["regen"] = now + PIE["regen"]
        speed = PIE["speed"] * (1.5 if kind == "pie_carrot" else 1)
        life = PIE["life"] * (1.3 if kind == "pie_carrot" else 1)
        for a in ((-0.28, 0.0, 0.28) if kind == "pie_tomato" else (0.0,)):
            vx, vy = ux * math.cos(a) - uy * math.sin(a), ux * math.sin(a) + uy * math.cos(a)
            self.seq += 1
            self.pies.append({"id": self.seq, "by": uid, "x": pl["x"] + vx * 6, "y": pl["y"] - 6 + vy * 6,
                              "vx": vx * speed, "vy": vy * speed, "until": now + life, "kind": kind})
        pl["dir"] = (3 if ux > 0 else 2) if abs(ux) > abs(uy) else (0 if uy > 0 else 1)
        return None

    # ---------- 模擬 ----------
    def tick(self, now: int, dt: float = 0.1) -> None:
        if not self.active:
            return
        for pl in self.p.values():
            if pl["ammo"] < PIE["ammo"] and now >= pl["regen"]:
                pl["ammo"] += 1
                pl["regen"] = now + PIE["regen"]
        self._pies(now, dt)
        if self.phase not in ("sleep", "leave"):
            self._helpers(now, dt)
            if self.fed >= self.need:
                self.result = "fed"
                self.pies = []
                self._phase("sleep", now)
                self._ev(k="full")
                self._reward(now, True)
                return
            if now >= self.until:
                self.result = "left"
                self.pies = []
                self._phase("leave", now)
                self._ev(k="escape")
                self._reward(now, False)
                return
        if now < self.phase_end:
            return
        ph = self.phase
        if ph == "idle":
            r = self.rng.random()
            if r < 0.45:
                self._phase("mouth", now)
                self._ev(k="mouth")
            elif r < 0.75:
                cands = [s for s in SPOTS if math.hypot(s[0] - self.x, s[1] - self.y) > 40]
                self.target = self.rng.choice(cands)
                self._phase("jumpWarn", now)
                self._ev(k="jumpWarn", x=self.target[0], y=self.target[1], r=SQUASH_R)
            else:
                self._phase("croakWarn", now)
                self._ev(k="croakWarn", x=round(self.x), y=round(self.y), r=CROAK_R)
        elif ph == "mouth":
            self._phase("idle", now)
        elif ph == "jumpWarn":
            self._phase("jump", now)
        elif ph == "jump":
            self.x, self.y = self.target or (self.x, self.y)
            self._stun_near(self.x, self.y, SQUASH_R, now, "squash")
            self._phase("idle", now)
        elif ph == "croakWarn":
            self._phase("croak", now)
            self._stun_near(self.x, self.y, CROAK_R, now, "croak")
        elif ph == "croak":
            self._phase("idle", now)
        elif ph in ("sleep", "leave"):
            self.active = False
            self.phase = "gone"
            self._ev(k="gone")

    def _stun_near(self, x: float, y: float, r: float, now: int, kind: str) -> None:
        hit = []
        for uid, pl in self.p.items():
            if math.hypot(pl["x"] - x, pl["y"] - y) <= r:
                pl["stun"] = now + STUN_MS
                hit.append(uid)
        self._ev(k=kind, x=round(x), y=round(y), r=r, ids=hit)

    def _pies(self, now: int, dt: float) -> None:
        keep = []
        cx, cy = self.x, self.y - BODY_R
        airborne = self.phase == "jump"
        for pie in self.pies:
            pie["x"] += pie["vx"] * dt
            pie["y"] += pie["vy"] * dt
            kind = pie.get("kind")
            reach = BODY_R + (18 if kind == "pie_pumpkin" else 4)
            if not airborne and math.hypot(pie["x"] - cx, pie["y"] - cy) <= reach:
                gain = (MOUTH_BONUS if self.phase == "mouth" else 1) * (2 if kind == "pie_strawberry" else 1)
                if kind == "pie_beet" and self.phase in ("idle", "mouth"):   # 甜菜派：牠忍不住張大嘴
                    self.phase, self.phase_end = "mouth", max(self.phase_end, now + PHASES["mouth"])
                    self._ev(k="mouth")
                self.fed += gain
                fan = self.fans.get(pie["by"])
                if fan:
                    fan["hits"] += 1
                    fan["fed"] += gain
                self._ev(k="eat", by=pie["by"], v=gain, x=round(pie["x"]), y=round(pie["y"]))
                continue
            if now >= pie["until"]:
                self._ev(k="splat", x=round(pie["x"]), y=round(pie["y"]))
                continue
            keep.append(pie)
        self.pies = keep

    def _helpers(self, now: int, dt: float) -> None:
        for uid, pl in self.p.items():
            if not pl["bot"] or now < pl["stun"]:
                continue
            # 看到預警就躲開（偶爾慢半拍）
            danger = None
            if self.phase == "jumpWarn" and self.target and math.hypot(pl["x"] - self.target[0], pl["y"] - self.target[1]) < SQUASH_R + 8:
                danger = self.target
            elif self.phase == "croakWarn" and math.hypot(pl["x"] - self.x, pl["y"] - self.y) < CROAK_R + 8:
                danger = (self.x, self.y)
            if danger and now >= pl["react"]:
                if not pl["goal"] or pl["goal"][2] != "flee":
                    pl["react"] = now + self.rng.randint(150, 700)
                    a = math.atan2(pl["y"] - danger[1], pl["x"] - danger[0]) + self.rng.uniform(-0.5, 0.5)
                    pl["goal"] = (danger[0] + math.cos(a) * (CROAK_R + 30), danger[1] + math.sin(a) * (CROAK_R + 30), "flee")
            elif not danger and (pl["goal"] is None or now >= pl["think"]):
                pl["think"] = now + self.rng.randint(2500, 4500)
                a = self.rng.uniform(0, 2 * math.pi)
                d = self.rng.uniform(70, 110)
                pl["goal"] = (self.x + math.cos(a) * d, self.y - BODY_R + math.sin(a) * d * 0.7, "walk")
            g = pl["goal"]
            if g:
                gx, gy = clamp(g[0], 40, 440), clamp(g[1], 50, 262)
                dx, dy = gx - pl["x"], gy - pl["y"]
                d = math.hypot(dx, dy)
                if d > 1:
                    step = min(d, 50 * dt)
                    pl["x"] += dx / d * step
                    pl["y"] += dy / d * step
                    pl["dir"] = (3 if dx > 0 else 2) if abs(dx) > abs(dy) else (0 if dy > 0 else 1)
            if self.phase != "jump" and now >= pl["cool"] and self.rng.random() < 0.035:
                tx, ty = self.x - pl["x"], self.y - BODY_R - (pl["y"] - 6)
                n = math.hypot(tx, ty) or 1
                err = self.rng.uniform(-0.3, 0.3)
                ux, uy = tx / n, ty / n
                self._throw(uid, pl, ux - uy * err, uy + ux * err, now)

    def _reward(self, now: int, fed: bool) -> None:
        out = []
        top = max(self.fans.values(), key=lambda f: f["fed"], default=None)
        for uid, f in self.fans.items():
            if fed and f["hits"] >= 1:
                gold = GOLD_BASE + GOLD_PER_HIT * min(f["hits"], GOLD_MAX_HITS)
            elif f["hits"] >= 3:
                gold = CONSOLATION
            else:
                gold = 0
            out.append({"id": uid, "name": f["name"], "hits": f["hits"], "fed": f["fed"], "gold": gold, "full": fed,
                        "top": top is f and f["fed"] > 0})
        self.reward_due = out

    # ---------- 給前端 ----------
    def snapshot(self, now: int) -> dict[str, Any]:
        out: dict[str, Any] = {"on": self.active, "ph": self.phase, "end": self.phase_end, "until": self.until, "now": now,
                               "x": round(self.x), "y": round(self.y), "need": self.need, "fed": self.fed, "result": self.result}
        if self.active:
            if self.target and self.phase in ("jumpWarn", "jump"):
                out["tx"], out["ty"] = round(self.target[0]), round(self.target[1])
            out["H"] = [[uid, pl["name"], round(pl["x"], 1), round(pl["y"], 1), pl["dir"], pl["sprite"]]
                        for uid, pl in self.p.items() if pl["bot"]]
            out["S"] = [uid for uid, pl in self.p.items() if now < pl["stun"]]
            out["K"] = [[p["id"], round(p["x"], 1), round(p["y"], 1), round(p["vx"]), round(p["vy"]), p.get("kind")] for p in self.pies]
            out["top"] = sorted(([f["name"], f["fed"]] for f in self.fans.values()), key=lambda r: -r[1])[:5]
        if self.events:
            out["ev"] = self.events
        return out

    def ammo_of(self, uid: str) -> int:
        pl = self.p.get(uid)
        return pl["ammo"] if pl else PIE["ammo"]
