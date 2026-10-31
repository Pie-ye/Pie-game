"""廣場九個常駐派對的鎮民補位（伺服器）。

有真人報名、等了 FILL_MS 還湊不到三人時，小傑與艾芙琳奶奶（和前端沙盒同一組 NPC）來湊人數；
開場後鎮民照各派對規則行動，間隔 STEP_MS 之間隨機，像真人一樣會猶豫、偶爾犯錯，不會秒殺。
鎮民沒有存檔，不領獎金（PlazaService._pay_* 會跳過 npc: 開頭的人）。
"""

from __future__ import annotations

import random
from typing import Any

from . import plaza_logic as L

BOTS = [("npc:kid", "小傑"), ("npc:granny", "艾芙琳奶奶")]
FILL_MS = 12000
STEP_MS = (700, 2000)
KINDS = ("party", "seek", "hot", "tug", "haul", "light", "hill", "smash", "vase")

JOIN = {
    "party": L.party_join, "seek": L.seek_join, "hot": L.hot_join, "tug": L.tug_join, "haul": L.haul_join,
    "light": L.light_join, "hill": L.hill_join, "smash": L.smash_join, "vase": L.vase_join,
}


def is_bot(uid: str) -> bool:
    return str(uid).startswith("npc:")


def humans(rnd: dict[str, Any] | None) -> list[str]:
    return [u for u in (rnd or {}).get("order") or [] if not is_bot(u)]


def fill(kind: str, rnd: dict[str, Any], now: int) -> dict[str, Any]:
    """補鎮民到開始倒數（或補完）；回傳新的回合物件。"""
    for bid, name in BOTS:
        if rnd.get("status") != "open":
            break
        r = JOIN[kind](rnd, bid, name, now)
        if r.get("round") is not None:
            rnd = r["round"]
    return rnd


def act(kind: str, rnd: dict[str, Any], b: str, now: int, rng: random.Random, memo: dict[str, Any]) -> bool:
    """鎮民 b 做一個動作；有改變回合就回傳 True。memo 是這個鎮民的小筆記（例如扛寶物的時間）。"""
    r: dict[str, Any] = {}
    if kind == "party":
        free = [s for s in L.PARTY_SPOTS if s["id"] not in (rnd.get("taken") or {})]
        if free and rng.random() < 0.45:
            s = rng.choice(free)
            r = L.party_grab(rnd, b, s["id"], s["x"], s["y"], now)
    elif kind == "seek":
        hidden = rnd.get("hidden") or {}
        if rnd.get("seeker") == b:
            if rng.random() < 0.4:
                s = rng.choice(L.SEEK_SPOTS)
                r = L.seek_check(rnd, b, s["id"], s["x"], s["y"], now)
        elif b not in hidden:
            free = [s for s in L.SEEK_SPOTS if s["id"] not in hidden.values()]
            if free:
                s = rng.choice(free)
                r = L.seek_hide(rnd, b, s["id"], s["x"], s["y"], now)
    elif kind == "hot":
        if rnd.get("holder") == b and now - int(rnd.get("heldAt") or 0) >= L.HOT_PASS_MS + rng.randint(200, 1600):
            r = L.hot_take(rnd, b, L.HOT_JOIN["x"], L.HOT_JOIN["y"], now)
    elif kind == "tug":
        side = (rnd.get("team") or {}).get(b)
        s = L.TUG_SPOT_BY.get(side) if side else None
        if s:
            for _ in range(rng.randint(1, 2)):
                r = L.tug_pull(rnd, b, s["id"], s["x"], s["y"], now)
    elif kind == "haul":
        holder = rnd.get("holder")
        if holder == b:
            if now - memo.get("carry", now) >= memo.get("walk", 3000):
                r = L.haul_drop(rnd, b, L.HAUL_DROP["x"], L.HAUL_DROP["y"], now)
        elif holder is None and rng.random() < 0.5:
            r = L.haul_take(rnd, b, L.HAUL_JOIN["x"], L.HAUL_JOIN["y"], now)
            if r.get("ok"):
                memo["carry"], memo["walk"] = now, rng.randint(2600, 4200)   # 從木桶走到大鍋要幾秒
    elif kind == "light":
        p = (rnd.get("players") or {}).get(b) or {}
        if not (rnd.get("out") or {}).get(b) and not (rnd.get("done") or {}).get(b):
            score = int(p.get("score") or 0)
            if 0 <= score < len(L.LIGHT_SPOTS):
                s = L.LIGHT_SPOTS[score]
                green = L.light_of(rnd, now) == "green"
                if (green and rng.random() < 0.55) or (not green and rng.random() < 0.04):
                    r = L.light_dash(rnd, b, s["id"], s["x"], s["y"], now)
    elif kind == "hill":
        if rnd.get("holder") != b and rng.random() < 0.3:
            r = L.hill_take(rnd, b, L.HILL_JOIN["x"], L.HILL_JOIN["y"], now)
    elif kind == "smash":
        if L.smash_up(rnd, now) and (rnd.get("lastHit") or {}).get(b) != L.smash_pop(rnd, now) and rng.random() < 0.55:
            r = L.smash_hit(rnd, b, L.SMASH_JOIN["x"], L.SMASH_JOIN["y"], now)
    elif kind == "vase":
        holder = rnd.get("holder")
        team = rnd.get("team") or {}
        if holder != b and (holder is None or team.get(holder) != team.get(b)) and rng.random() < 0.35:
            r = L.vase_take(rnd, b, L.VASE_JOIN["x"], L.VASE_JOIN["y"], now)
    return bool(r.get("ok"))
