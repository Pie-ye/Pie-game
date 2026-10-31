"""限時尋寶活動：活動期間每天在幾張共用地圖藏南瓜燈，找到按 E 收下。候選點要和前端 src/game/hunt.js 一致。"""

from __future__ import annotations

import hashlib
import math
from typing import Any

HUNTS = [
    {"id": "halloween2026", "name": "萬聖節南瓜燈", "from": "2026-10-31", "to": "2026-11-02", "perDay": 8, "gold": 15, "bonus": 60},
]
SPOTS: dict[str, list[list[int]]] = {
    "plaza": [[255, 227], [371, 139], [443, 250], [451, 88], [368, 30], [96, 208], [140, 147]],
    "town": [[580, 156], [170, 406], [763, 389], [380, 209], [158, 161], [394, 401], [718, 157]],
    "arena": [[444, 136], [42, 121], [446, 32], [446, 214], [56, 211], [30, 49], [358, 254]],
    "frontier": [[370, 107], [383, 207], [443, 76], [83, 152], [223, 161], [157, 60], [245, 83]],
}
ALL = [(f"{m}:{i}", m, xy) for m, lst in SPOTS.items() for i, xy in enumerate(lst)]
REACH = 30


def active(day: str) -> dict[str, Any] | None:
    return next((h for h in HUNTS if h["from"] <= day <= h["to"]), None)


def today(h: dict[str, Any], day: str) -> list[tuple[str, str, list[int]]]:
    """今天藏在哪：依日期決定（大家一樣），每張地圖至少一顆。"""
    key = lambda s: hashlib.sha256(f"{h['id']}|{day}|{s[0]}".encode()).hexdigest()
    picks = []
    for m in SPOTS:
        picks.append(min((s for s in ALL if s[1] == m), key=key))
    rest = sorted((s for s in ALL if s not in picks), key=key)
    return picks + rest[: max(0, h["perDay"] - len(picks))]


def state(rec: dict[str, Any], day: str) -> dict[str, Any]:
    st = rec.get("hunt")
    if not isinstance(st, dict) or st.get("day") != day:
        st = rec["hunt"] = {"day": day, "found": []}
    return st


def view(rec: dict[str, Any], day: str) -> dict[str, Any]:
    h = active(day)
    if not h:
        return {"on": False}
    st = state(rec, day)
    return {"on": True, "id": h["id"], "name": h["name"], "to": h["to"], "gold": h["gold"], "bonus": h["bonus"],
            "spots": [{"id": sid, "map": m, "x": xy[0], "y": xy[1], "found": sid in st["found"]} for sid, m, xy in today(h, day)]}


def find(rec: dict[str, Any], day: str, sid: Any, x: Any, y: Any) -> dict[str, Any]:
    h = active(day)
    if not h:
        return {"ok": False, "code": "no_hunt", "msg": "活動已經結束了"}
    spots = {s[0]: s for s in today(h, day)}
    if sid not in spots:
        return {"ok": False, "code": "bad_spot", "msg": "這裡沒有南瓜燈"}
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y)):
        return {"ok": False, "code": "bad_message", "msg": "位置不對"}
    _, _m, (sx, sy) = spots[sid]
    if math.hypot(x - sx, y - sy) > REACH:
        return {"ok": False, "code": "too_far", "msg": "再走近一點"}
    st = state(rec, day)
    if sid in st["found"]:
        return {"ok": False, "code": "found", "msg": "這顆已經找到了"}
    st["found"].append(sid)
    gold = h["gold"]
    all_found = len(st["found"]) >= len(spots)
    if all_found:
        gold += h["bonus"]
    rec["gold"] += gold
    return {"ok": True, "reward": gold, "count": len(st["found"]), "total": len(spots), "all": all_found}
