"""派派鎮的遊戲規則（伺服器權威版）。

數字一律來自 plaza_rules.json（由前端模組匯出，tools/pie-plaza/export_rules.mjs），
邏輯對應前端 src/farm/state.js、house/catalog.js、fish/fishing.js；兩邊有一致性測試。
全部是純函式，不碰資料庫或網路。
"""

from __future__ import annotations

import json
import random
import re
import time
from pathlib import Path
from typing import Any

RULES = json.loads((Path(__file__).with_name("plaza_rules.json")).read_text(encoding="utf-8"))
FARM = RULES["farm"]
FIELD = FARM["field"]
DEBRIS = RULES["debris"]
DEBRIS_KEYS = list(DEBRIS)
CROPS = RULES["crops"]
CROP_KEYS = list(CROPS)
GROW_MS = FARM["growMs"]
FISH = RULES["fish"]
FISH_BY_ID = {f["id"]: f for f in FISH}
ITEMS = set(RULES["itemNames"]) | {f"fish_{f['id']}" for f in FISH if not f.get("junk")}
SELL = {**{k: c["sell"] for k, c in CROPS.items()}, **{f"fish_{f['id']}": f["price"] for f in FISH if f.get("price")}}
FURNITURE = {f["k"]: f for f in RULES["furniture"]}
ROOM = RULES["room"]
TZ_OFFSET = 8 * 3600
FARM_TOOLS = {"axe", "pickaxe", "sickle", "hoe", "wateringcan", "seed"}
KEY_RE = re.compile(r"^(\d{1,2}),(\d{1,2})$")


# ---------- 與前端相同的決定性亂數（logic.js 的 hueOf／seedOf／mulberry） ----------
def _imul(a: int, b: int) -> int:
    return (a * b) & 0xFFFFFFFF


def hue_of(text: str) -> int:
    h = 2166136261
    for ch in str(text):
        unit = ch.encode("utf-16-le")[:2]                  # JS 的 charCodeAt(0)：第一個 UTF-16 單位
        h ^= int.from_bytes(unit, "little")
        h = _imul(h, 16777619)
    return h % 360


def seed_of(text: str) -> int:
    return hue_of(text) * 7919 + len(str(text).encode("utf-16-le")) // 2


def mulberry(seed: int):
    a = seed & 0xFFFFFFFF

    def rnd() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        t &= 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rnd


# ---------- 地形 ----------
def is_path(x: int, y: int) -> bool:
    px, py, house = FARM["pathX"], FARM["pathY"], FARM["house"]
    return (x in px and house["ty"] <= y <= py[1]) or (y in py and x >= px[0])


def in_field(x: int, y: int) -> bool:
    return FIELD["x0"] <= x <= FIELD["x1"] and FIELD["y0"] <= y <= FIELD["y1"]


def in_pond(x: int, y: int) -> bool:
    p = FARM["pond"]
    return p["x0"] <= x <= p["x1"] and p["y0"] <= y <= p["y1"]


def new_farm(owner: str) -> dict[str, Any]:
    """和前端 newFarm 一樣：依擁有者 id 決定雜物分布。"""
    rnd = mulberry(seed_of(f"farm:{owner}"))
    debris: dict[str, Any] = {}
    for y in range(FIELD["y0"], FIELD["y1"] + 1):
        for x in range(FIELD["x0"], FIELD["x1"] + 1):
            if is_path(x, y) or in_pond(x, y) or (abs(x - 20) <= 3 and y <= 13):
                continue
            r = rnd()
            if r > 0.42:
                continue
            t = "weed" if r < 0.22 else "stone" if r < 0.32 else "twig" if r < 0.38 else "stump"
            debris[f"{x},{y}"] = {"t": t, "hp": DEBRIS[t]["hp"], "look": int(rnd() * DEBRIS[t]["looks"])}
    return {"debris": debris, "tilled": {}, "crops": {}}


def new_player(owner: str, name: str) -> dict[str, Any]:
    return {
        "v": 1, "name": name, "farm": new_farm(owner), "inv": {}, "seeds": dict(FARM["starterSeeds"]), "seedSel": "wheat",
        "gold": FARM["starterGold"], "decor": default_decor(), "look": None,
        "social": {"open": True, "friends": [], "coop": [], "liked": {}, "likes": 0}, "at": 0,
    }


# ---------- 農場動作 ----------
def tile(farm: dict[str, Any], k: str) -> dict[str, Any]:
    """一格目前的狀態（給前端的修補資料）。"""
    return {"d": farm["debris"].get(k), "t": farm["tilled"].get(k), "c": farm["crops"].get(k)}


def _add(inv: dict[str, int], k: str, n: int) -> None:
    inv[k] = inv.get(k, 0) + n


def use_tool(owner_rec: dict[str, Any], actor_rec: dict[str, Any], tool: str, x: int, y: int, now_ms: int) -> dict[str, Any]:
    """在 owner 的農場 (x,y) 用工具。種子從 actor 扣、掉落物給 owner。回傳 {ok, msg, ...}。直接修改紀錄。"""
    farm = owner_rec["farm"]
    k = f"{x},{y}"
    if not in_field(x, y):
        return {"ok": False, "msg": "這裡不能耕作"}
    if is_path(x, y):
        return {"ok": False, "msg": "這是小路，留著走路吧"}
    d = farm["debris"].get(k)
    if d:
        info = DEBRIS[d["t"]]
        if tool != info["tool"]:
            return {"ok": False, "msg": f"要用{ {'axe': '斧頭', 'pickaxe': '十字鎬', 'sickle': '鐮刀'}[info['tool']] }才行"}
        d["hp"] -= 1
        if d["hp"] > 0:
            return {"ok": True, "msg": "再敲幾下…", "hit": d["t"]}
        del farm["debris"][k]
        _add(owner_rec["inv"], info["drop"], 3 if d["t"] == "stump" else 1)
        return {"ok": True, "msg": f"得到 {RULES['itemNames'][info['drop']]}", "cleared": d["t"], "drop": info["drop"]}
    crop = farm["crops"].get(k)
    if tool == "sickle" and crop:
        if crop["s"] < 3:
            return {"ok": False, "msg": "還沒成熟"}
        del farm["crops"][k]
        _add(owner_rec["inv"], crop["t"], 1)
        return {"ok": True, "msg": f"收成 {CROPS[crop['t']]['name']}！", "harvest": crop["t"]}
    if tool == "hoe":
        if k in farm["tilled"]:
            return {"ok": False, "msg": "已經翻過土了"}
        farm["tilled"][k] = {"w": 0}
        return {"ok": True, "msg": "", "till": True}
    if tool == "wateringcan":
        if k not in farm["tilled"]:
            return {"ok": False, "msg": "先用鋤頭翻土"}
        farm["tilled"][k]["w"] = now_ms
        if crop:
            crop["w"] = now_ms
        return {"ok": True, "msg": "", "water": True}
    if tool == "seed":
        t = actor_rec["seedSel"]
        if t not in CROPS or actor_rec["seeds"].get(t, 0) <= 0:
            return {"ok": False, "msg": "沒有種子了，去雜貨店買吧"}
        if k not in farm["tilled"]:
            return {"ok": False, "msg": "先用鋤頭翻土"}
        if crop:
            return {"ok": False, "msg": "這裡已經種了東西"}
        actor_rec["seeds"][t] -= 1
        if not actor_rec["seeds"][t]:
            del actor_rec["seeds"][t]
            next_seed(actor_rec)
        farm["crops"][k] = {"t": t, "s": 0, "w": farm["tilled"][k].get("w", 0)}
        return {"ok": True, "msg": f"種下{CROPS[t]['name']}", "plant": t}
    if tool in ("axe", "pickaxe", "sickle"):
        return {"ok": False, "msg": "這裡沒有東西"}
    return {"ok": False, "msg": ""}


def grow(farm: dict[str, Any], now_ms: int) -> list[str]:
    """作物成長（伺服器時間）。回傳有變化的格子。"""
    changed = []
    for k, c in farm["crops"].items():
        if c["s"] < 3 and c.get("w") and now_ms - c["w"] >= GROW_MS * CROPS[c["t"]]["grow"]:
            c["s"] += 1
            c["w"] = 0
            if k in farm["tilled"]:
                farm["tilled"][k]["w"] = 0
            changed.append(k)
    for k, t in farm["tilled"].items():
        if t.get("w") and now_ms - t["w"] > GROW_MS * 2 and k not in farm["crops"]:
            t["w"] = 0
            changed.append(k)
    return changed


def next_seed(rec: dict[str, Any]) -> str:
    have = [k for k in CROP_KEYS if rec["seeds"].get(k, 0) > 0]
    if have:
        i = have.index(rec["seedSel"]) if rec["seedSel"] in have else -1
        rec["seedSel"] = have[(i + 1) % len(have)]
    return rec["seedSel"]


def buy_seed(rec: dict[str, Any], k: str, n: int, discount: float = 1.0) -> dict[str, Any]:
    if k not in CROPS or not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 99:
        return {"ok": False, "msg": "沒有這種種子"}
    price = -(-CROPS[k]["seed"] * int(discount * 100) // 100)        # 無條件進位，和前端 Math.ceil 一致
    if rec["gold"] < price * n:
        return {"ok": False, "msg": "金幣不夠"}
    rec["gold"] -= price * n
    _add(rec["seeds"], k, n)
    if rec["seeds"].get(rec["seedSel"], 0) <= 0:
        rec["seedSel"] = k
    return {"ok": True, "msg": f"買了 {n} 包{CROPS[k]['name']}種子", "price": price}


def ship_all(rec: dict[str, Any]) -> dict[str, Any]:
    total, sold = 0, []
    for k in list(rec["inv"]):
        price, n = SELL.get(k), rec["inv"][k]
        if price and n > 0:
            total += price * n
            sold.append([k, n])
            del rec["inv"][k]
    rec["gold"] += total
    return {"ok": True, "total": total, "sold": sold}


# ---------- 釣魚 ----------
def _in_hours(h: int, span: list[int]) -> bool:
    a, b = span
    return a <= h < b if a <= b else h >= a or h < b


def roll_fish(where: str, hour: int, contest: bool, rng: random.Random) -> dict[str, Any]:
    pool = [(f, f["w"] + (f.get("contest", 0) if contest else 0)) for f in FISH
            if where in f["where"] and (not f.get("hours") or _in_hours(hour, f["hours"]))]
    pool = [(f, w) for f, w in pool if w > 0]
    r = rng.random() * sum(w for _, w in pool)
    for f, w in pool:
        r -= w
        if r <= 0:
            return f
    return pool[-1][0]


def fish_size(f: dict[str, Any], rng: random.Random) -> int:
    return 0 if f.get("junk") else round(12 + f["diff"] * 9 + rng.random() * (10 + f["diff"] * 8))


# ---------- 時間與活動（台北時間） ----------
def taipei(ms: float | None = None) -> time.struct_time:
    return time.gmtime((ms if ms is not None else time.time() * 1000) / 1000 + TZ_OFFSET)


def event_active(event_id: str, ms: float | None = None) -> bool:
    t = taipei(ms)
    dow = (t.tm_wday + 1) % 7                        # Python 週一=0；前端週日=0
    for e in RULES["events"]:
        if e["id"] != event_id or (e["days"] and dow not in e["days"]):
            continue
        if any(a <= t.tm_hour < b for a, b in e["slots"]):
            return True
    return False


def taipei_day(ms: float | None = None) -> str:
    return time.strftime("%Y-%m-%d", taipei(ms))


# ---------- 外觀與小屋 ----------
def sanitize_look(look: Any) -> list[int] | None:
    sizes = RULES["look"]
    if not isinstance(look, list) or len(look) != len(sizes):
        return None
    if not all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v < n for v, n in zip(look, sizes)):
        return None
    return list(look)


def default_decor() -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for k, tx, ty in [("rugGL", 9, 7), ("bedGreen", 1, 3), ("dresser", 2, 3), ("tableN", 14, 6), ("chairL", 13, 6), ("chairR", 15, 6),
                      ("plantN", 18, 3), ("lampG", 17, 3), ("paintField", 6, 1), ("clockRound", 10, 1), ("paintFlower", 13, 1),
                      ("bookcase", 5, 3), ("bookcaseBig", 7, 3), ("sofa", 4, 9), ("flowerPot", 1, 11)]:
        if can_place(items, k, tx, ty):
            items.append({"k": k, "tx": tx, "ty": ty})
    return {"floor": "tan", "wall": "cream", "style": "houseThatch", "ext": {"roof": 0, "wall": 0, "yard": [1, 0, 0, 3]}, "items": items}


def _cells(f: dict[str, Any], tx: int, ty: int) -> list[tuple[int, int]]:
    return [(x, y) for y in range(ty, ty + f["h"]) for x in range(tx, tx + f["w"])]


def can_place(items: list[dict[str, Any]], k: str, tx: int, ty: int) -> bool:
    f = FURNITURE.get(k)
    if not f:
        return False
    fl, door, wall_rows = ROOM["floor"], ROOM["door"], ROOM["wallRows"]
    cells = _cells(f, tx, ty)
    if f.get("wall"):
        if not all(fl["x0"] <= x <= fl["x1"] and 1 <= y < wall_rows for x, y in cells):
            return False
    else:
        if not all(fl["x0"] <= x <= fl["x1"] and fl["y0"] <= y <= fl["y1"] for x, y in cells):
            return False
        if not f.get("flat") and any(y == fl["y1"] and x in (door["tx"], door["tx"] + 1) for x, y in cells):
            return False
    taken = set()
    for it in items:
        g = FURNITURE.get(it["k"])
        if not g or bool(g.get("flat")) != bool(f.get("flat")) or bool(g.get("wall")) != bool(f.get("wall")):
            continue
        taken.update(_cells(g, it["tx"], it["ty"]))
    return not any(c in taken for c in cells)


def sanitize_decor(d: Any) -> dict[str, Any]:
    base = default_decor()
    if not isinstance(d, dict):
        return base
    idx = lambda v, n: v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < n else 0  # noqa: E731
    ext = d.get("ext") if isinstance(d.get("ext"), dict) else {}
    yard = ext.get("yard") if isinstance(ext.get("yard"), list) else []
    out = {
        "floor": d.get("floor") if d.get("floor") in RULES["floors"] else "tan",
        "wall": d.get("wall") if d.get("wall") in RULES["walls"] else "cream",
        "style": d.get("style") if d.get("style") in RULES["houseStyles"] else "houseThatch",
        "ext": {"roof": idx(ext.get("roof"), RULES["exterior"]["roof"]), "wall": idx(ext.get("wall"), RULES["exterior"]["wall"]),
                "yard": [idx(yard[i] if i < len(yard) else 0, RULES["exterior"]["yard"]) for i in range(4)]},
        "items": [],
    }
    for it in (d.get("items") if isinstance(d.get("items"), list) else [])[:80]:
        if not isinstance(it, dict):
            continue
        tx, ty = it.get("tx"), it.get("ty")
        if isinstance(tx, int) and isinstance(ty, int) and can_place(out["items"], it.get("k"), tx, ty):
            out["items"].append({"k": it["k"], "tx": tx, "ty": ty})
    return out


# ---------- 匯入舊的雲端存檔（前端精簡格式 p1） ----------
def import_saves(owner: str, name: str, saves: dict[str, Any]) -> dict[str, Any]:
    rec = new_player(owner, name)
    p = saves.get("farm")
    if isinstance(p, dict) and p.get("v") == "p1":
        farm = {"debris": {}, "tilled": {}, "crops": {}}
        for row in p.get("d") or []:
            if isinstance(row, list) and len(row) == 5 and 0 <= row[2] < len(DEBRIS_KEYS):
                x, y, ti, hp, look = row
                t = DEBRIS_KEYS[ti]
                if in_field(x, y):
                    farm["debris"][f"{x},{y}"] = {"t": t, "hp": max(1, min(DEBRIS[t]["hp"], int(hp))), "look": int(look) % DEBRIS[t]["looks"]}
        for row in p.get("t") or []:
            if isinstance(row, list) and len(row) == 3 and in_field(row[0], row[1]):
                farm["tilled"][f"{row[0]},{row[1]}"] = {"w": int(row[2] or 0) * 1000}
        for row in p.get("c") or []:
            if isinstance(row, list) and len(row) == 5 and 0 <= row[2] < len(CROP_KEYS) and f"{row[0]},{row[1]}" in farm["tilled"]:
                farm["crops"][f"{row[0]},{row[1]}"] = {"t": CROP_KEYS[row[2]], "s": max(0, min(3, int(row[3]))), "w": int(row[4] or 0) * 1000}
        rec["farm"] = farm
        rec["inv"] = {k: max(0, min(99999, int(n))) for k, n in (p.get("inv") or {}).items() if k in ITEMS and isinstance(n, int) and n > 0}
        rec["seeds"] = {k: max(0, min(99999, int(n))) for k, n in (p.get("seeds") or {}).items() if k in CROPS and isinstance(n, int) and n > 0}
        rec["seedSel"] = p.get("sel") if p.get("sel") in CROPS else "wheat"
        rec["gold"] = max(0, min(10_000_000, int(p.get("gold") or 0)))
    if isinstance(saves.get("decor"), dict):
        rec["decor"] = sanitize_decor(saves["decor"])
    look = saves.get("look")
    if isinstance(look, dict):
        rec["look"] = sanitize_look(look.get("l"))
    s = saves.get("social")
    if isinstance(s, dict):
        rec["social"]["open"] = s.get("open") is not False
        rec["social"]["likes"] = max(0, min(1_000_000, int(s.get("likes") or 0)))
        rec["social"]["friends"] = [{"id": str(f["id"])[:64], "name": str(f.get("name") or "鎮民")[:20]}
                                    for f in (s.get("friends") or [])[:100] if isinstance(f, dict) and f.get("id")]
    return rec


def pack_farm(farm: dict[str, Any]) -> dict[str, Any]:
    """給前端的精簡格式（和前端 packFarm 相同，時間是秒）。"""
    xy = lambda k: [int(v) for v in k.split(",")]  # noqa: E731
    sec = lambda ms: round(ms / 1000) if ms else 0  # noqa: E731
    return {
        "d": [[*xy(k), DEBRIS_KEYS.index(d["t"]), d["hp"], d["look"]] for k, d in farm["debris"].items()],
        "t": [[*xy(k), sec(t.get("w", 0))] for k, t in farm["tilled"].items()],
        "c": [[*xy(k), CROP_KEYS.index(c["t"]), c["s"], sec(c.get("w", 0))] for k, c in farm["crops"].items()],
    }
