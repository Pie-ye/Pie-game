"""鎮民急徵：每天 3 張收購單（大家看到的一樣），價格是基礎價的 1.4 倍，每張限 3 位鎮民交貨、每人每張一次。"""

from __future__ import annotations

import hashlib
import math
from typing import Any

NPCS = ["皮爺爺", "瑪莉", "阿胖", "克林", "蘿蘋", "哈醫生", "妮可", "路易斯鎮長", "小傑", "艾芙琳奶奶", "山姆", "工頭阿土"]
PER_DAY = 3
FILLS = 3
MULT = 1.4


def today(day: str, pool: list[str], base: dict[str, int]) -> list[dict[str, Any]]:
    h = lambda s: int(hashlib.sha256(f"orders|{day}|{s}".encode()).hexdigest(), 16)
    items = sorted(pool, key=h)[:PER_DAY]
    out = []
    for i, item in enumerate(items):
        n = 2 + h(f"n{i}") % 5 if base.get(item, 0) < 150 else 1 + h(f"n{i}") % 3
        out.append({"i": i, "npc": NPCS[h(f"npc{i}") % len(NPCS)], "item": item, "n": n, "unit": math.ceil(base[item] * MULT)})
    return out


def state(st: dict[str, Any] | None, day: str) -> dict[str, Any]:
    if not isinstance(st, dict) or st.get("day") != day:
        st = {"day": day, "fills": {}}
    return st


def view(st: dict[str, Any], orders: list[dict[str, Any]], uid: str) -> list[dict[str, Any]]:
    return [{**o, "left": FILLS - len(st["fills"].get(str(o["i"]), [])), "done": uid in st["fills"].get(str(o["i"]), [])} for o in orders]


def fill(st: dict[str, Any], orders: list[dict[str, Any]], rec: dict[str, Any], uid: str, i: Any) -> dict[str, Any]:
    o = next((x for x in orders if x["i"] == i), None)
    if o is None:
        return {"ok": False, "code": "bad_order", "msg": "沒有這張收購單"}
    who = st["fills"].setdefault(str(i), [])
    if uid in who:
        return {"ok": False, "code": "done", "msg": "這張你今天交過了"}
    if len(who) >= FILLS:
        return {"ok": False, "code": "full", "msg": "這張已經收滿了，明天再來"}
    if rec["inv"].get(o["item"], 0) < o["n"]:
        return {"ok": False, "code": "no_item", "msg": "數量不夠"}
    rec["inv"][o["item"]] -= o["n"]
    if not rec["inv"][o["item"]]:
        del rec["inv"][o["item"]]
    gold = o["unit"] * o["n"]
    rec["gold"] += gold
    who.append(uid)
    return {"ok": True, "reward": gold, "npc": o["npc"]}
