"""派派鎮的遊戲規則（伺服器權威版）。

數字一律來自 plaza_rules.json（由前端模組匯出，tools/pie-plaza/export_rules.mjs），
邏輯對應前端 src/farm/state.js、house/catalog.js、fish/fishing.js；兩邊有一致性測試。
全部是純函式，不碰資料庫或網路。
"""

from __future__ import annotations

import json
import math
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
        "gold": FARM["starterGold"], "decor": default_decor(), "look": None, "shares": {},
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


GROW_SPEED = 1.0          # 全鎮工程「派派溫室」蓋好後由 PlazaService 設成 1.25


def grow(farm: dict[str, Any], now_ms: int) -> list[str]:
    """作物成長（伺服器時間）。回傳有變化的格子。"""
    changed = []
    for k, c in farm["crops"].items():
        if c["s"] < 3 and c.get("w") and now_ms - c["w"] >= GROW_MS * CROPS[c["t"]]["grow"] / GROW_SPEED:
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


# ---------- 派派鎮民交易所（虛擬指數，只用遊戲金幣） ----------
TICKERS = (
    {"id": "GROC", "name": "雜貨", "why": "鎮民買種子會推升"},
    {"id": "BAKE", "name": "麵包", "why": "出貨小麥會推升"},
    {"id": "SHOW", "name": "劇場", "why": "餵瑞吉會推升"},
    {"id": "WISH", "name": "許願", "why": "向噴水池許願會推升"},
    {"id": "FISH", "name": "漁獲", "why": "釣魚或出貨魚會推升"},
)
TICKER_IDS = tuple(t["id"] for t in TICKERS)
X_HOURS = (9, 16)          # 台北時間，含 9 不含 16
X_MID0 = 100
X_MIN, X_MAX = 20, 400
X_SHARE_MAX = 9999
X_ACT = {"seed": "GROC", "wheat": "BAKE", "feed": "SHOW", "wish": "WISH", "fish": "FISH"}


def shares_of(rec: dict[str, Any]) -> dict[str, int]:
    raw = rec.get("shares")
    out: dict[str, int] = {}
    if isinstance(raw, dict):
        for k in TICKER_IDS:
            n = raw.get(k, 0)
            if isinstance(n, int) and not isinstance(n, bool) and 0 < n <= X_SHARE_MAX:
                out[k] = n
    rec["shares"] = out
    return out


def market_open(ms: float | None) -> bool:
    t = taipei(ms)
    return X_HOURS[0] <= t.tm_hour < X_HOURS[1]


def slot_key(ms: float) -> str:
    t = taipei(ms)
    return f"{t.tm_year:04d}-{t.tm_mon:02d}-{t.tm_mday:02d}T{t.tm_hour:02d}:{t.tm_min // 5 * 5:02d}"


def week_monday(ms: float) -> str:
    t = taipei(ms)
    epoch = ms / 1000 + TZ_OFFSET - t.tm_wday * 86400
    mt = time.gmtime(epoch)
    return f"{mt.tm_year:04d}-{mt.tm_mon:02d}-{mt.tm_mday:02d}"


def spread(mid: int) -> tuple[int, int]:
    """買價 / 賣價：中間價上下各約 1%，合計 2% 價差。買一定比賣貴。"""
    mid = int(mid)
    buy = max(mid + 1, (mid * 101 + 99) // 100)
    sell = min(mid - 1, mid * 99 // 100)
    return buy, sell


def new_exchange(ms: float | None = None) -> dict[str, Any]:
    mids = {k: X_MID0 for k in TICKER_IDS}
    now = time.time() * 1000 if ms is None else ms
    return {
        "mid": dict(mids), "prev": dict(mids), "open": dict(mids),
        "act": {k: 0 for k in TICKER_IDS}, "slot": None, "day": None,
        "divDay": week_monday(now), "divMid": dict(mids),
    }


def sanitize_exchange(raw: Any, ms: float) -> dict[str, Any]:
    base = new_exchange(ms)
    if not isinstance(raw, dict):
        return base
    def mids(src: Any) -> dict[str, int]:
        out = dict(base["mid"])
        if isinstance(src, dict):
            for k in TICKER_IDS:
                v = src.get(k)
                if isinstance(v, int) and not isinstance(v, bool) and X_MIN <= v <= X_MAX:
                    out[k] = v
        return out
    act = {k: 0 for k in TICKER_IDS}
    if isinstance(raw.get("act"), dict):
        for k in TICKER_IDS:
            v = raw["act"].get(k, 0)
            if isinstance(v, int) and not isinstance(v, bool) and 0 < v <= 9999:
                act[k] = v
    slot = raw.get("slot") if isinstance(raw.get("slot"), str) and len(raw["slot"]) <= 20 else None
    day = raw.get("day") if isinstance(raw.get("day"), str) and len(raw["day"]) <= 12 else None
    div = raw.get("divDay") if isinstance(raw.get("divDay"), str) and len(raw["divDay"]) <= 12 else base["divDay"]
    return {
        "mid": mids(raw.get("mid")), "prev": mids(raw.get("prev")), "open": mids(raw.get("open")),
        "act": act, "slot": slot, "day": day, "divDay": div, "divMid": mids(raw.get("divMid") or raw.get("mid")),
    }


def note_act(ex: dict[str, Any], ticker: str, n: int = 1) -> None:
    if ticker in TICKER_IDS and isinstance(n, int) and not isinstance(n, bool) and n > 0:
        ex["act"][ticker] = min(9999, ex["act"].get(ticker, 0) + n)


def tick_exchange(ex: dict[str, Any], ms: float, rng: random.Random) -> bool:
    """開盤中每 5 分鐘跳一次。第一次只鎖定時段、不改價。回傳是否改了中間價。"""
    if not market_open(ms):
        return False
    key = slot_key(ms)
    if ex.get("slot") is None:
        t = taipei(ms)
        ex["slot"] = key
        ex["day"] = f"{t.tm_year:04d}-{t.tm_mon:02d}-{t.tm_mday:02d}"
        return False
    if ex.get("slot") == key:
        return False
    t = taipei(ms)
    day = f"{t.tm_year:04d}-{t.tm_mon:02d}-{t.tm_mday:02d}"
    new_day = ex.get("day") != day
    ex["prev"] = dict(ex["mid"])
    for k in TICKER_IDS:
        mid = ex["mid"][k]
        impulse = math.tanh(ex["act"].get(k, 0) / 8.0) * 0.05
        noise = rng.uniform(-0.012, 0.012)
        nxt = mid * (1 + impulse + noise) + (X_MID0 - mid) * 0.008
        ex["mid"][k] = max(X_MIN, min(X_MAX, int(round(nxt))))
        ex["act"][k] = 0
    ex["slot"] = key
    if new_day:
        ex["day"] = day
        ex["open"] = dict(ex["mid"])
    return True


def dividend_due(ex: dict[str, Any], ms: float) -> str | None:
    """本週一 09:00（台北）之後，若還沒發過這週股息就回傳該週一日期。"""
    t = taipei(ms)
    monday = week_monday(ms)
    if t.tm_wday == 0 and t.tm_hour < X_HOURS[0]:
        return None
    if ex.get("divDay") == monday:
        return None
    return monday


def pay_dividend(rec: dict[str, Any], mids: dict[str, int]) -> int:
    gold = 0
    for k, n in shares_of(rec).items():
        gold += n * int(mids.get(k, X_MID0)) // 100
    if gold:
        rec["gold"] += gold
    return gold


def apply_trade(rec: dict[str, Any], ex: dict[str, Any], side: Any, ticker: Any, n: Any, ms: float) -> dict[str, Any]:
    if not market_open(ms):
        return {"ok": False, "code": "closed", "msg": "交易所休息中，營業時間早上 9 點到下午 4 點（台北）"}
    if ticker not in TICKER_IDS:
        return {"ok": False, "code": "bad_ticker", "msg": "沒有這檔指數"}
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 99:
        return {"ok": False, "code": "bad_message", "msg": "數量 1–99"}
    buy, sell = spread(ex["mid"][ticker])
    shares = shares_of(rec)
    if side == "buy":
        cost = buy * n
        if rec["gold"] < cost:
            return {"ok": False, "code": "no_gold", "msg": "金幣不夠"}
        have = shares.get(ticker, 0)
        if have + n > X_SHARE_MAX:
            return {"ok": False, "code": "too_many", "msg": f"一檔最多持有 {X_SHARE_MAX} 股"}
        rec["gold"] -= cost
        shares[ticker] = have + n
        rec["shares"] = shares
        return {"ok": True, "side": "buy", "ticker": ticker, "n": n, "price": buy, "paid": cost}
    if side == "sell":
        have = shares.get(ticker, 0)
        if have < n:
            return {"ok": False, "code": "no_shares", "msg": "持股不夠"}
        gain = sell * n
        rec["gold"] += gain
        if have - n:
            shares[ticker] = have - n
        else:
            shares.pop(ticker, None)
        rec["shares"] = shares
        return {"ok": True, "side": "sell", "ticker": ticker, "n": n, "price": sell, "got": gain}
    return {"ok": False, "code": "bad_message", "msg": "只能買進或賣出"}


def quote_view(ex: dict[str, Any], rec: dict[str, Any], ms: float) -> dict[str, Any]:
    shares = shares_of(rec)
    quotes = []
    for t in TICKERS:
        mid = ex["mid"][t["id"]]
        buy, sell = spread(mid)
        prev, day = ex["prev"].get(t["id"], mid), ex["open"].get(t["id"], mid)
        quotes.append({
            "id": t["id"], "name": t["name"], "why": t["why"],
            "mid": mid, "buy": buy, "sell": sell,
            "chg": mid - prev, "day": mid - day, "hold": shares.get(t["id"], 0),
        })
    return {"open": market_open(ms), "hours": list(X_HOURS), "quotes": quotes, "shares": shares, "gold": rec["gold"]}


# ---------- 廣場搶寶（與前端 src/game/party.js 相同） ----------
_P = RULES.get("party") or {}
PARTY_MIN = int(_P.get("min", 3))
PARTY_MAX = int(_P.get("max", 8))
PARTY_REACH = int(_P.get("reach", 20))
PARTY_COUNTDOWN_MS = int(_P.get("countdownMs", 9000))
PARTY_ROUND_MS = int(_P.get("roundMs", 45000))
PARTY_PAYOUT = list(_P.get("payout") or [40, 20, 10])
PARTY_REST = int(_P.get("restPay", 5))
PARTY_SPOTS = list(_P.get("spots") or [])
PARTY_SPOT_BY = {s["id"]: s for s in PARTY_SPOTS if isinstance(s, dict) and "id" in s}


def new_party() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "taken": {},
        "startedAt": None, "endedAt": None, "payouts": None, "paid": {}, "rank": [],
    }


def _party_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def settle_party(rnd: dict[str, Any], now: int) -> None:
    ranking = sorted(rnd["order"], key=lambda u: (-rnd["players"][u]["score"], rnd["order"].index(u)))
    payouts = {uid: (PARTY_PAYOUT[i] if i < len(PARTY_PAYOUT) else PARTY_REST) for i, uid in enumerate(ranking)}
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking


def maybe_expire_party(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + PARTY_COUNTDOWN_MS
        if now < live_at:
            return rnd
        rnd["status"] = "live"
        rnd["startedAt"] = live_at
    if rnd.get("status") != "live":
        return rnd
    started = rnd.get("startedAt") or 0
    if now - started >= PARTY_ROUND_MS:
        settle_party(rnd, now)
    return rnd


def party_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_party(rnd, now) or new_party()
    spots = [{**s, "takenBy": rnd["taken"].get(s["id"])} for s in PARTY_SPOTS]
    players = [{"id": uid, "name": rnd["players"][uid]["name"], "score": rnd["players"][uid]["score"]} for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players, "spots": spots, "taken": dict(rnd["taken"]),
        "startedAt": rnd["startedAt"], "endedAt": rnd["endedAt"],
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": PARTY_MIN, "max": PARTY_MAX,
        "countdownMs": PARTY_COUNTDOWN_MS, "roundMs": PARTY_ROUND_MS,
    }


def party_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = party_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    return v


def party_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _party_fail("bad_message", "無效的玩家")
    cur = new_party() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_party_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_party_fail("party_live", "搶寶已經開始了"), "round": cur}
    if len(cur["order"]) >= PARTY_MAX:
        return {**_party_fail("party_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16], "score": 0}
    cur["order"].append(uid)
    if len(cur["order"]) >= PARTY_MAX:
        cur["status"] = "live"
        cur["startedAt"] = now
    elif len(cur["order"]) >= PARTY_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def party_grab(rnd: dict[str, Any] | None, uid: str, spot: Any, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _party_fail("party_none", "現在沒有搶寶")
    maybe_expire_party(rnd, now)
    if rnd["status"] == "over":
        return {**_party_fail("party_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_party_fail("not_live", "還沒開始，先去寶箱報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_party_fail("not_in_party", "你不在這一輪"), "round": rnd}
    s = PARTY_SPOT_BY.get(spot) if isinstance(spot, str) else None
    if not s:
        return {**_party_fail("bad_message", "沒有這個寶點"), "round": rnd}
    if rnd["taken"].get(s["id"]):
        return {**_party_fail("spot_taken", "已經被拿走了"), "round": rnd}
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return {**_party_fail("bad_message", "位置不對"), "round": rnd}
    if math.hypot(float(x) - s["x"], float(y) - s["y"]) > PARTY_REACH:
        return {**_party_fail("too_far", "再走近一點"), "round": rnd}
    rnd["taken"][s["id"]] = uid
    rnd["players"][uid]["score"] += 1
    if len(rnd["taken"]) >= len(PARTY_SPOTS):
        settle_party(rnd, now)
    return {"ok": True, "round": rnd, "grabbed": s["id"]}


def party_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _party_fail("party_none", "現在沒有搶寶")
    maybe_expire_party(rnd, now)
    if rnd["status"] == "over":
        return {**_party_fail("party_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_party_fail("not_in_party", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_party_fail("party_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < PARTY_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_party_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 釣魚大賽（與前端 src/game/contest.js 相同） ----------
_C = RULES.get("contest") or {}
CONTEST_PAYOUT = list(_C.get("payout") or [40, 20, 10])
CONTEST_REST = int(_C.get("restPay", 5))
CONTEST_GOLDEN = int(_C.get("goldenMult", 2))


def fishing_slot(ms: int) -> str | None:
    if not event_active("fishing", ms):
        return None
    t = taipei(ms)
    for e in RULES["events"]:
        if e["id"] != "fishing":
            continue
        for a, b in e["slots"]:
            if a <= t.tm_hour < b:
                return f"{a}-{b}"
    return None


def new_contest(slot: str | None = None) -> dict[str, Any]:
    return {
        "status": "open", "slot": slot, "players": {}, "order": [],
        "startedAt": None, "endedAt": None, "payouts": None, "paid": {}, "rank": [],
    }


def settle_contest(rnd: dict[str, Any], now: int) -> None:
    ranking = sorted(rnd["order"], key=lambda u: (-rnd["players"][u]["score"], rnd["order"].index(u)))
    payouts = {uid: (CONTEST_PAYOUT[i] if i < len(CONTEST_PAYOUT) else CONTEST_REST) for i, uid in enumerate(ranking)}
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking


def maybe_expire_contest(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd or rnd.get("status") != "open":
        return rnd
    slot = fishing_slot(now)
    if slot and slot == rnd.get("slot"):
        return rnd
    if rnd.get("order"):
        settle_contest(rnd, now)
    else:
        rnd["status"] = "over"
        rnd["endedAt"] = now
    return rnd


def contest_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    if rnd:
        maybe_expire_contest(rnd, now)
    cur = rnd or new_contest(fishing_slot(now))
    players = [{"id": uid, "name": cur["players"][uid]["name"], "score": cur["players"][uid]["score"], "n": cur["players"][uid]["n"]} for uid in cur.get("order") or []]
    return {
        "status": cur["status"], "slot": cur.get("slot"), "active": bool(fishing_slot(now)),
        "players": players, "startedAt": cur.get("startedAt"), "endedAt": cur.get("endedAt"),
        "payouts": dict(cur["payouts"]) if cur.get("payouts") else None,
        "rank": list(cur.get("rank") or []),
    }


def contest_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = contest_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    return v


def contest_catch(rnd: dict[str, Any] | None, uid: str, name: str, fish_id: Any, size: Any, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return {"ok": False, "code": "bad_message", "msg": "無效的玩家"}
    slot = fishing_slot(now)
    if not slot:
        return {"ok": False, "code": "contest_closed", "msg": "現在不是釣魚大賽時段", "round": rnd}
    try:
        sz = int(size)
    except (TypeError, ValueError):
        sz = 0
    if sz <= 0:
        return {"ok": True, "round": rnd, "points": 0}
    cur = new_contest(slot) if (rnd is None or rnd.get("status") == "over" or rnd.get("slot") != slot) else rnd
    if uid not in cur["players"]:
        cur["players"][uid] = {"name": str(name or "訪客")[:16], "score": 0, "n": 0}
        cur["order"].append(uid)
        if not cur.get("startedAt"):
            cur["startedAt"] = now
    pts = sz * CONTEST_GOLDEN if fish_id == "golden" else sz
    cur["players"][uid]["score"] += pts
    cur["players"][uid]["n"] += 1
    return {"ok": True, "round": cur, "points": pts}


def apply_contest_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 營火捉迷藏（與前端 src/game/seek.js 相同） ----------
_S = RULES.get("seek") or {}
SEEK_MIN = int(_S.get("min", 3))
SEEK_MAX = int(_S.get("max", 8))
SEEK_REACH = int(_S.get("reach", 20))
SEEK_COUNTDOWN_MS = int(_S.get("countdownMs", 9000))
SEEK_ROUND_MS = int(_S.get("roundMs", 45000))
SEEK_PAYOUT = list(_S.get("payout") or [40, 20, 10])
SEEK_REST = int(_S.get("restPay", 5))
SEEK_SPOTS = list(_S.get("spots") or [])
SEEK_SPOT_BY = {s["id"]: s for s in SEEK_SPOTS if isinstance(s, dict) and "id" in s}


def new_seek() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "seeker": None, "hidden": {},
        "startedAt": None, "endedAt": None, "payouts": None, "paid": {}, "rank": [],
    }


def _seek_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def _seek_go_live(rnd: dict[str, Any], now: int) -> None:
    rnd["status"] = "live"
    rnd["startedAt"] = now
    rnd["seeker"] = rnd["order"][0] if rnd["order"] else None


def settle_seek(rnd: dict[str, Any], now: int) -> None:
    hiders = [u for u in rnd["order"] if rnd.get("hidden", {}).get(u)]
    if hiders:
        ranking = sorted(hiders, key=lambda u: rnd["order"].index(u))
        ranking += [u for u in rnd["order"] if u not in hiders]
    else:
        ranking = list(rnd["order"])
    payouts = {uid: (SEEK_PAYOUT[i] if i < len(SEEK_PAYOUT) else SEEK_REST) for i, uid in enumerate(ranking)}
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking


def maybe_expire_seek(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + SEEK_COUNTDOWN_MS
        if now < live_at:
            return rnd
        _seek_go_live(rnd, live_at)
    if rnd.get("status") != "live":
        return rnd
    if now - (rnd.get("startedAt") or 0) >= SEEK_ROUND_MS:
        settle_seek(rnd, now)
    return rnd


def seek_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_seek(rnd, now) or new_seek()
    hidden = rnd.get("hidden") or {}
    inv = {spot: uid for uid, spot in hidden.items()}
    spots = [{**s, "takenBy": inv.get(s["id"])} for s in SEEK_SPOTS]
    players = [{"id": uid, "name": rnd["players"][uid]["name"], "seeker": rnd.get("seeker") == uid, "hidden": uid in hidden} for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players, "spots": spots, "seeker": rnd.get("seeker"),
        "hidden": dict(hidden), "startedAt": rnd.get("startedAt"), "endedAt": rnd.get("endedAt"),
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": SEEK_MIN, "max": SEEK_MAX,
        "countdownMs": SEEK_COUNTDOWN_MS, "roundMs": SEEK_ROUND_MS,
    }


def seek_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = seek_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    return v


def seek_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _seek_fail("bad_message", "無效的玩家")
    cur = new_seek() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_seek_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_seek_fail("seek_live", "捉迷藏已經開始了"), "round": cur}
    if len(cur["order"]) >= SEEK_MAX:
        return {**_seek_fail("seek_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16]}
    cur["order"].append(uid)
    if len(cur["order"]) >= SEEK_MAX:
        _seek_go_live(cur, now)
    elif len(cur["order"]) >= SEEK_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def _seek_near(s: dict[str, Any], x: Any, y: Any) -> dict[str, Any] | None:
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return _seek_fail("bad_message", "位置不對")
    if math.hypot(float(x) - s["x"], float(y) - s["y"]) > SEEK_REACH:
        return _seek_fail("too_far", "再走近一點")
    return None


def seek_hide(rnd: dict[str, Any] | None, uid: str, spot: Any, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _seek_fail("seek_none", "現在沒有捉迷藏")
    maybe_expire_seek(rnd, now)
    if rnd["status"] == "over":
        return {**_seek_fail("seek_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_seek_fail("not_live", "還沒開始，先去西南草地報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_seek_fail("not_in_seek", "你不在這一輪"), "round": rnd}
    if rnd.get("seeker") == uid:
        return {**_seek_fail("not_hider", "尋人要去檢查藏點，不能自己藏"), "round": rnd}
    if rnd.get("hidden", {}).get(uid):
        return {**_seek_fail("already_hidden", "你已經藏好了"), "round": rnd}
    s = SEEK_SPOT_BY.get(spot) if isinstance(spot, str) else None
    if not s:
        return {**_seek_fail("bad_message", "沒有這個藏點"), "round": rnd}
    if s["id"] in (rnd.get("hidden") or {}).values():
        return {**_seek_fail("spot_taken", "這裡已經有人了"), "round": rnd}
    bad = _seek_near(s, x, y)
    if bad:
        bad["round"] = rnd
        return bad
    rnd.setdefault("hidden", {})[uid] = s["id"]
    return {"ok": True, "round": rnd, "hid": s["id"]}


def seek_check(rnd: dict[str, Any] | None, uid: str, spot: Any, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _seek_fail("seek_none", "現在沒有捉迷藏")
    maybe_expire_seek(rnd, now)
    if rnd["status"] == "over":
        return {**_seek_fail("seek_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_seek_fail("not_live", "還沒開始，先去西南草地報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_seek_fail("not_in_seek", "你不在這一輪"), "round": rnd}
    if rnd.get("seeker") != uid:
        return {**_seek_fail("not_seeker", "你不是尋人"), "round": rnd}
    s = SEEK_SPOT_BY.get(spot) if isinstance(spot, str) else None
    if not s:
        return {**_seek_fail("bad_message", "沒有這個藏點"), "round": rnd}
    bad = _seek_near(s, x, y)
    if bad:
        bad["round"] = rnd
        return bad
    found = next((u for u, sp in (rnd.get("hidden") or {}).items() if sp == s["id"]), None)
    if not found:
        return {**_seek_fail("empty_spot", "這裡沒有人"), "round": rnd}
    del rnd["hidden"][found]
    rnd["seeker"] = found
    return {"ok": True, "round": rnd, "found": found}


def seek_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _seek_fail("seek_none", "現在沒有捉迷藏")
    maybe_expire_seek(rnd, now)
    if rnd["status"] == "over":
        return {**_seek_fail("seek_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_seek_fail("not_in_seek", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_seek_fail("seek_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < SEEK_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_seek_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 傳南瓜（與前端 src/game/hot.js 相同） ----------
_H = RULES.get("hot") or {}
HOT_MIN = int(_H.get("min", 3))
HOT_MAX = int(_H.get("max", 8))
HOT_REACH = int(_H.get("reach", 20))
HOT_COUNTDOWN_MS = int(_H.get("countdownMs", 9000))
HOT_ROUND_MS = int(_H.get("roundMs", 45000))
HOT_PAYOUT = list(_H.get("payout") or [40, 20, 10])
HOT_REST = int(_H.get("restPay", 5))
HOT_PASS_MS = int(_H.get("passMs", 1200))
_HJ = _H.get("join") or {}
HOT_JOIN = {"x": int(_HJ.get("x", 128)), "y": int(_HJ.get("y", 100)), "k": _HJ.get("k") or "pumpkinItem"}


def new_hot() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "holder": None, "heldAt": None, "hold": {},
        "startedAt": None, "endedAt": None, "payouts": None, "paid": {}, "rank": [],
    }


def _hot_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def _hot_go_live(rnd: dict[str, Any], now: int) -> None:
    rnd["status"] = "live"
    rnd["startedAt"] = now
    rnd["holder"] = rnd["order"][0] if rnd["order"] else None
    rnd["heldAt"] = now if rnd["holder"] else None
    rnd["hold"] = {}


def settle_hot(rnd: dict[str, Any], now: int) -> None:
    holder = rnd.get("holder")
    hold = rnd.setdefault("hold", {})
    if holder and rnd.get("heldAt") is not None:
        hold[holder] = int(hold.get(holder) or 0) + max(0, now - int(rnd["heldAt"]))
    rest = sorted((u for u in rnd["order"] if u != holder), key=lambda u: (int(hold.get(u) or 0), rnd["order"].index(u)))
    ranking = rest + ([holder] if holder and holder in rnd["order"] else [])
    payouts = {uid: (HOT_PAYOUT[i] if i < len(HOT_PAYOUT) else HOT_REST) for i, uid in enumerate(ranking)}
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking


def maybe_expire_hot(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + HOT_COUNTDOWN_MS
        if now < live_at:
            return rnd
        _hot_go_live(rnd, live_at)
    if rnd.get("status") != "live":
        return rnd
    if now - (rnd.get("startedAt") or 0) >= HOT_ROUND_MS:
        settle_hot(rnd, now)
    return rnd


def hot_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_hot(rnd, now) or new_hot()
    players = [{"id": uid, "name": rnd["players"][uid]["name"], "holder": rnd.get("holder") == uid} for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players, "holder": rnd.get("holder"),
        "heldAt": rnd.get("heldAt"),
        "startedAt": rnd.get("startedAt"), "endedAt": rnd.get("endedAt"),
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": HOT_MIN, "max": HOT_MAX,
        "countdownMs": HOT_COUNTDOWN_MS, "roundMs": HOT_ROUND_MS,
        "join": dict(HOT_JOIN),
    }


def hot_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = hot_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    return v


def hot_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _hot_fail("bad_message", "無效的玩家")
    cur = new_hot() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_hot_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_hot_fail("hot_live", "傳南瓜已經開始了"), "round": cur}
    if len(cur["order"]) >= HOT_MAX:
        return {**_hot_fail("hot_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16]}
    cur["order"].append(uid)
    if len(cur["order"]) >= HOT_MAX:
        _hot_go_live(cur, now)
    elif len(cur["order"]) >= HOT_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def _hot_near(x: Any, y: Any) -> dict[str, Any] | None:
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return _hot_fail("bad_message", "位置不對")
    if math.hypot(float(x) - HOT_JOIN["x"], float(y) - HOT_JOIN["y"]) > HOT_REACH:
        return _hot_fail("too_far", "再走近南瓜一點")
    return None


def hot_take(rnd: dict[str, Any] | None, uid: str, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _hot_fail("hot_none", "現在沒有傳南瓜")
    maybe_expire_hot(rnd, now)
    if rnd["status"] == "over":
        return {**_hot_fail("hot_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_hot_fail("not_live", "還沒開始，先去雞舍旁邊報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_hot_fail("not_in_hot", "你不在這一輪"), "round": rnd}
    if rnd.get("holder") != uid:
        return {**_hot_fail("not_holder", "南瓜不在你手上，看好下一個是誰"), "round": rnd}
    if now - int(rnd.get("heldAt") or 0) < HOT_PASS_MS:
        return {**_hot_fail("too_soon", "剛接到，等一下再傳"), "round": rnd}
    bad = _hot_near(x, y)
    if bad:
        bad["round"] = rnd
        return bad
    hold = rnd.setdefault("hold", {})
    hold[uid] = int(hold.get(uid) or 0) + max(0, now - int(rnd["heldAt"]))
    nxt = rnd["order"][(rnd["order"].index(uid) + 1) % len(rnd["order"])]
    rnd["holder"] = nxt
    rnd["heldAt"] = now
    return {"ok": True, "round": rnd, "holder": nxt, "passed": uid}


def hot_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _hot_fail("hot_none", "現在沒有傳南瓜")
    maybe_expire_hot(rnd, now)
    if rnd["status"] == "over":
        return {**_hot_fail("hot_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_hot_fail("not_in_hot", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_hot_fail("hot_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < HOT_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_hot_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 廣場拔河（與前端 src/game/tug.js 相同） ----------
_T = RULES.get("tug") or {}
TUG_MIN = int(_T.get("min", 3))
TUG_MAX = int(_T.get("max", 8))
TUG_REACH = int(_T.get("reach", 20))
TUG_COUNTDOWN_MS = int(_T.get("countdownMs", 9000))
TUG_ROUND_MS = int(_T.get("roundMs", 45000))
TUG_PAYOUT = list(_T.get("payout") or [40, 20, 10])
TUG_REST = int(_T.get("restPay", 5))
TUG_WIN = int(_T.get("winPay", 40))
TUG_LOSE = int(_T.get("losePay", 5))
TUG_SPOTS = list(_T.get("spots") or [])
TUG_SPOT_BY = {s["id"]: s for s in TUG_SPOTS if isinstance(s, dict) and "id" in s}


def new_tug() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "team": {}, "pulls": {},
        "score": {"L": 0, "R": 0}, "startedAt": None, "endedAt": None,
        "payouts": None, "paid": {}, "rank": [], "winner": None,
    }


def _tug_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def _tug_side(i: int) -> str:
    return "L" if i % 2 == 0 else "R"


def _tug_go_live(rnd: dict[str, Any], now: int) -> None:
    rnd["status"] = "live"
    rnd["startedAt"] = now
    for i, uid in enumerate(rnd["order"]):
        rnd.setdefault("team", {})[uid] = _tug_side(i)
        rnd.setdefault("pulls", {})[uid] = int(rnd.get("pulls", {}).get(uid) or 0)


def settle_tug(rnd: dict[str, Any], now: int) -> None:
    left = int((rnd.get("score") or {}).get("L") or 0)
    right = int((rnd.get("score") or {}).get("R") or 0)
    winner = "L" if left > right else "R" if right > left else None
    team = rnd.get("team") or {}
    pulls = rnd.get("pulls") or {}
    ranking = sorted(
        rnd["order"],
        key=lambda u: (
            0 if winner and team.get(u) == winner else 1 if winner else 0,
            -(int(pulls.get(u) or 0)),
            rnd["order"].index(u),
        ),
    )
    payouts: dict[str, int] = {}
    if not winner:
        payouts = {uid: (TUG_PAYOUT[i] if i < len(TUG_PAYOUT) else TUG_REST) for i, uid in enumerate(ranking)}
    else:
        for i, uid in enumerate(ranking):
            payouts[uid] = (TUG_PAYOUT[i] if i < len(TUG_PAYOUT) else TUG_WIN) if team.get(uid) == winner else TUG_LOSE
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking
    rnd["winner"] = winner


def maybe_expire_tug(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + TUG_COUNTDOWN_MS
        if now < live_at:
            return rnd
        _tug_go_live(rnd, live_at)
    if rnd.get("status") != "live":
        return rnd
    if now - (rnd.get("startedAt") or 0) >= TUG_ROUND_MS:
        settle_tug(rnd, now)
    return rnd


def tug_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_tug(rnd, now) or new_tug()
    players = [{"id": uid, "name": rnd["players"][uid]["name"], "team": (rnd.get("team") or {}).get(uid), "pulls": int((rnd.get("pulls") or {}).get(uid) or 0)} for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players, "score": dict(rnd.get("score") or {"L": 0, "R": 0}),
        "winner": rnd.get("winner"), "startedAt": rnd.get("startedAt"), "endedAt": rnd.get("endedAt"),
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": TUG_MIN, "max": TUG_MAX,
        "countdownMs": TUG_COUNTDOWN_MS, "roundMs": TUG_ROUND_MS,
        "spots": [dict(s) for s in TUG_SPOTS],
    }


def tug_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = tug_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    v["yourTeam"] = (rnd.get("team") or {}).get(uid) if rnd else None
    return v


def tug_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _tug_fail("bad_message", "無效的玩家")
    cur = new_tug() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_tug_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_tug_fail("tug_live", "拔河已經開始了"), "round": cur}
    if len(cur["order"]) >= TUG_MAX:
        return {**_tug_fail("tug_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16]}
    cur["order"].append(uid)
    if len(cur["order"]) >= TUG_MAX:
        _tug_go_live(cur, now)
    elif len(cur["order"]) >= TUG_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def _tug_near(s: dict[str, Any], x: Any, y: Any) -> dict[str, Any] | None:
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return _tug_fail("bad_message", "位置不對")
    if math.hypot(float(x) - s["x"], float(y) - s["y"]) > TUG_REACH:
        return _tug_fail("too_far", "再走近乾草樁一點")
    return None


def tug_pull(rnd: dict[str, Any] | None, uid: str, side: Any, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _tug_fail("tug_none", "現在沒有拔河")
    maybe_expire_tug(rnd, now)
    if rnd["status"] == "over":
        return {**_tug_fail("tug_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_tug_fail("not_live", "還沒開始，先去東邊草地報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_tug_fail("not_in_tug", "你不在這一輪"), "round": rnd}
    s = TUG_SPOT_BY.get(side) if isinstance(side, str) else None
    if not s:
        return {**_tug_fail("bad_message", "沒有這一岸"), "round": rnd}
    team = (rnd.get("team") or {}).get(uid)
    if team and team != s["id"]:
        return {**_tug_fail("wrong_side", "你是另一岸的人"), "round": rnd}
    bad = _tug_near(s, x, y)
    if bad:
        bad["round"] = rnd
        return bad
    rnd.setdefault("pulls", {})[uid] = int(rnd.get("pulls", {}).get(uid) or 0) + 1
    rnd.setdefault("score", {"L": 0, "R": 0})[s["id"]] = int(rnd.get("score", {}).get(s["id"]) or 0) + 1
    return {"ok": True, "round": rnd, "pulled": s["id"]}


def tug_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _tug_fail("tug_none", "現在沒有拔河")
    maybe_expire_tug(rnd, now)
    if rnd["status"] == "over":
        return {**_tug_fail("tug_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_tug_fail("not_in_tug", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_tug_fail("tug_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < TUG_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_tug_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 廣場搬寶（與前端 src/game/haul.js 相同） ----------
_U = RULES.get("haul") or {}
HAUL_MIN = int(_U.get("min", 3))
HAUL_MAX = int(_U.get("max", 8))
HAUL_REACH = int(_U.get("reach", 20))
HAUL_COUNTDOWN_MS = int(_U.get("countdownMs", 9000))
HAUL_ROUND_MS = int(_U.get("roundMs", 45000))
HAUL_PAYOUT = list(_U.get("payout") or [40, 20, 10])
HAUL_REST = int(_U.get("restPay", 5))
_UJ = _U.get("join") or {}
HAUL_JOIN = {"x": int(_UJ.get("x", 104)), "y": int(_UJ.get("y", 168)), "k": _UJ.get("k") or "barrel"}
_UD = _U.get("drop") or {}
HAUL_DROP = {"x": int(_UD.get("x", 368)), "y": int(_UD.get("y", 72)), "k": _UD.get("k") or "cauldron"}


def new_haul() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "holder": None, "scores": {},
        "startedAt": None, "endedAt": None, "payouts": None, "paid": {}, "rank": [],
    }


def _haul_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def _haul_go_live(rnd: dict[str, Any], now: int) -> None:
    rnd["status"] = "live"
    rnd["startedAt"] = now
    rnd["holder"] = None
    scores = rnd.setdefault("scores", {})
    for uid in rnd["order"]:
        scores[uid] = int(scores.get(uid) or 0)


def settle_haul(rnd: dict[str, Any], now: int) -> None:
    scores = rnd.get("scores") or {}
    ranking = sorted(
        rnd["order"],
        key=lambda u: (-int(scores.get(u) or 0), rnd["order"].index(u)),
    )
    payouts = {uid: (HAUL_PAYOUT[i] if i < len(HAUL_PAYOUT) else HAUL_REST) for i, uid in enumerate(ranking)}
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking


def maybe_expire_haul(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + HAUL_COUNTDOWN_MS
        if now < live_at:
            return rnd
        _haul_go_live(rnd, live_at)
    if rnd.get("status") != "live":
        return rnd
    if now - (rnd.get("startedAt") or 0) >= HAUL_ROUND_MS:
        settle_haul(rnd, now)
    return rnd


def haul_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_haul(rnd, now) or new_haul()
    players = [{"id": uid, "name": rnd["players"][uid]["name"], "holder": rnd.get("holder") == uid, "score": int((rnd.get("scores") or {}).get(uid) or 0)} for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players, "holder": rnd.get("holder"),
        "scores": dict(rnd.get("scores") or {}),
        "startedAt": rnd.get("startedAt"), "endedAt": rnd.get("endedAt"),
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": HAUL_MIN, "max": HAUL_MAX,
        "countdownMs": HAUL_COUNTDOWN_MS, "roundMs": HAUL_ROUND_MS,
        "join": dict(HAUL_JOIN), "drop": dict(HAUL_DROP),
    }


def haul_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = haul_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    return v


def haul_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _haul_fail("bad_message", "無效的玩家")
    cur = new_haul() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_haul_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_haul_fail("haul_live", "搬寶已經開始了"), "round": cur}
    if len(cur["order"]) >= HAUL_MAX:
        return {**_haul_fail("haul_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16]}
    cur["order"].append(uid)
    cur.setdefault("scores", {})[uid] = 0
    if len(cur["order"]) >= HAUL_MAX:
        _haul_go_live(cur, now)
    elif len(cur["order"]) >= HAUL_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def _haul_near(spot: dict[str, Any], x: Any, y: Any, msg: str) -> dict[str, Any] | None:
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return _haul_fail("bad_message", "位置不對")
    if math.hypot(float(x) - spot["x"], float(y) - spot["y"]) > HAUL_REACH:
        return _haul_fail("too_far", msg)
    return None


def haul_take(rnd: dict[str, Any] | None, uid: str, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _haul_fail("haul_none", "現在沒有搬寶")
    maybe_expire_haul(rnd, now)
    if rnd["status"] == "over":
        return {**_haul_fail("haul_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_haul_fail("not_live", "還沒開始，先去西邊木桶報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_haul_fail("not_in_haul", "你不在這一輪"), "round": rnd}
    if rnd.get("holder") == uid:
        return {**_haul_fail("already_holding", "寶物已經在你手上"), "round": rnd}
    bad = _haul_near(HAUL_JOIN, x, y, "再走近木桶一點")
    if bad:
        bad["round"] = rnd
        return bad
    rnd["holder"] = uid
    return {"ok": True, "round": rnd, "holder": uid}


def haul_drop(rnd: dict[str, Any] | None, uid: str, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _haul_fail("haul_none", "現在沒有搬寶")
    maybe_expire_haul(rnd, now)
    if rnd["status"] == "over":
        return {**_haul_fail("haul_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_haul_fail("not_live", "還沒開始，先去西邊木桶報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_haul_fail("not_in_haul", "你不在這一輪"), "round": rnd}
    if rnd.get("holder") != uid:
        return {**_haul_fail("empty_hands", "你手上沒有寶物"), "round": rnd}
    bad = _haul_near(HAUL_DROP, x, y, "再走近大鍋一點")
    if bad:
        bad["round"] = rnd
        return bad
    rnd.setdefault("scores", {})[uid] = int(rnd.get("scores", {}).get(uid) or 0) + 1
    rnd["holder"] = None
    return {"ok": True, "round": rnd, "score": rnd["scores"][uid]}


def haul_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _haul_fail("haul_none", "現在沒有搬寶")
    maybe_expire_haul(rnd, now)
    if rnd["status"] == "over":
        return {**_haul_fail("haul_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_haul_fail("not_in_haul", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_haul_fail("haul_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    (rnd.get("scores") or {}).pop(uid, None)
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < HAUL_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_haul_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 廣場紅綠燈（與前端 src/game/light.js 相同） ----------
_LGT = RULES.get("light") or {}
LIGHT_MIN = int(_LGT.get("min", 3))
LIGHT_MAX = int(_LGT.get("max", 8))
LIGHT_REACH = int(_LGT.get("reach", 20))
LIGHT_COUNTDOWN_MS = int(_LGT.get("countdownMs", 9000))
LIGHT_ROUND_MS = int(_LGT.get("roundMs", 45000))
LIGHT_GREEN_MS = int(_LGT.get("greenMs", 2500))
LIGHT_RED_MS = int(_LGT.get("redMs", 1800))
LIGHT_PAYOUT = list(_LGT.get("payout") or [40, 20, 10])
LIGHT_REST = int(_LGT.get("restPay", 5))
LIGHT_SPOTS = list(_LGT.get("spots") or [])
LIGHT_SPOT_BY = {s["id"]: s for s in LIGHT_SPOTS if isinstance(s, dict) and "id" in s}
_LJ = _LGT.get("join") or {}
LIGHT_JOIN = {"x": int(_LJ.get("x", 64)), "y": int(_LJ.get("y", 40)), "k": _LJ.get("k") or "railing"}


def new_light() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "out": {}, "done": {}, "finishAt": {},
        "startedAt": None, "endedAt": None, "payouts": None, "paid": {}, "rank": [],
    }


def _light_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def _light_go_live(rnd: dict[str, Any], now: int) -> None:
    rnd["status"] = "live"
    rnd["startedAt"] = now


def light_of(rnd: dict[str, Any] | None, now: int) -> str:
    if not rnd or rnd.get("status") != "live":
        return "green"
    t = max(0, now - (rnd.get("startedAt") or 0))
    cycle = LIGHT_GREEN_MS + LIGHT_RED_MS
    return "green" if (t % cycle) < LIGHT_GREEN_MS else "red"


def _light_remaining(rnd: dict[str, Any]) -> list[str]:
    out, done = rnd.get("out") or {}, rnd.get("done") or {}
    return [uid for uid in rnd["order"] if not out.get(uid) and not done.get(uid)]


def settle_light(rnd: dict[str, Any], now: int) -> None:
    out, done, finish = rnd.get("out") or {}, rnd.get("done") or {}, rnd.get("finishAt") or {}

    def key(uid: str):
        bucket = 0 if done.get(uid) else 2 if out.get(uid) else 1
        fin = int(finish.get(uid) or 0) if done.get(uid) else 0
        score = -int(rnd["players"][uid].get("score") or 0)
        return (bucket, fin if done.get(uid) else 0, score, rnd["order"].index(uid))

    ranking = sorted(rnd["order"], key=key)
    payouts = {uid: (LIGHT_PAYOUT[i] if i < len(LIGHT_PAYOUT) else LIGHT_REST) for i, uid in enumerate(ranking)}
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking


def maybe_expire_light(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + LIGHT_COUNTDOWN_MS
        if now < live_at:
            return rnd
        _light_go_live(rnd, live_at)
    if rnd.get("status") != "live":
        return rnd
    if now - (rnd.get("startedAt") or 0) >= LIGHT_ROUND_MS or not _light_remaining(rnd):
        settle_light(rnd, now)
    return rnd


def light_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_light(rnd, now) or new_light()
    players = [{
        "id": uid, "name": rnd["players"][uid]["name"],
        "score": int(rnd["players"][uid].get("score") or 0),
        "out": bool((rnd.get("out") or {}).get(uid)),
        "done": bool((rnd.get("done") or {}).get(uid)),
    } for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players, "spots": [dict(s) for s in LIGHT_SPOTS],
        "light": light_of(rnd, now), "startedAt": rnd.get("startedAt"), "endedAt": rnd.get("endedAt"),
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": LIGHT_MIN, "max": LIGHT_MAX,
        "countdownMs": LIGHT_COUNTDOWN_MS, "roundMs": LIGHT_ROUND_MS,
        "greenMs": LIGHT_GREEN_MS, "redMs": LIGHT_RED_MS,
    }


def light_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = light_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    me = next((p for p in v["players"] if p["id"] == uid), None)
    v["yourScore"] = me["score"] if me else 0
    v["yourOut"] = bool(me and me["out"])
    v["yourDone"] = bool(me and me["done"])
    return v


def light_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _light_fail("bad_message", "無效的玩家")
    cur = new_light() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_light_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_light_fail("light_live", "紅綠燈已經開始了"), "round": cur}
    if len(cur["order"]) >= LIGHT_MAX:
        return {**_light_fail("light_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16], "score": 0}
    cur["order"].append(uid)
    if len(cur["order"]) >= LIGHT_MAX:
        _light_go_live(cur, now)
    elif len(cur["order"]) >= LIGHT_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def light_dash(rnd: dict[str, Any] | None, uid: str, spot: Any, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _light_fail("light_none", "現在沒有紅綠燈")
    maybe_expire_light(rnd, now)
    if rnd["status"] == "over":
        return {**_light_fail("light_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_light_fail("not_live", "還沒開始，先去北邊欄杆報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_light_fail("not_in_light", "你不在這一輪"), "round": rnd}
    if (rnd.get("out") or {}).get(uid):
        return {**_light_fail("already_out", "紅燈時動了，這輪出局"), "round": rnd}
    if (rnd.get("done") or {}).get(uid):
        return {**_light_fail("already_done", "你已經到終點了"), "round": rnd}
    s = LIGHT_SPOT_BY.get(spot) if isinstance(spot, str) else None
    if not s:
        return {**_light_fail("bad_message", "沒有這個樁"), "round": rnd}
    score = int(rnd["players"][uid].get("score") or 0)
    need = LIGHT_SPOTS[score] if 0 <= score < len(LIGHT_SPOTS) else None
    if not need or need.get("id") != s["id"]:
        return {**_light_fail("wrong_spot", "要依序踩下一樁"), "round": rnd}
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return {**_light_fail("bad_message", "位置不對"), "round": rnd}
    if math.hypot(float(x) - s["x"], float(y) - s["y"]) > LIGHT_REACH:
        return {**_light_fail("too_far", "再走近一點"), "round": rnd}
    if light_of(rnd, now) == "red":
        rnd.setdefault("out", {})[uid] = True
        if not _light_remaining(rnd):
            settle_light(rnd, now)
        return {"ok": True, "round": rnd, "out": True, "light": "red"}
    rnd["players"][uid]["score"] = score + 1
    if rnd["players"][uid]["score"] >= len(LIGHT_SPOTS):
        rnd.setdefault("done", {})[uid] = True
        rnd.setdefault("finishAt", {})[uid] = now
    if not _light_remaining(rnd):
        settle_light(rnd, now)
    return {"ok": True, "round": rnd, "stepped": s["id"], "done": bool((rnd.get("done") or {}).get(uid))}


def light_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _light_fail("light_none", "現在沒有紅綠燈")
    maybe_expire_light(rnd, now)
    if rnd["status"] == "over":
        return {**_light_fail("light_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_light_fail("not_in_light", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_light_fail("light_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < LIGHT_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_light_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 廣場占席（與前端 src/game/hill.js 相同） ----------
_HL = RULES.get("hill") or {}
HILL_MIN = int(_HL.get("min", 3))
HILL_MAX = int(_HL.get("max", 8))
HILL_REACH = int(_HL.get("reach", 20))
HILL_COUNTDOWN_MS = int(_HL.get("countdownMs", 9000))
HILL_ROUND_MS = int(_HL.get("roundMs", 45000))
HILL_PAYOUT = list(_HL.get("payout") or [40, 20, 10])
HILL_REST = int(_HL.get("restPay", 5))
_HJ = _HL.get("join") or {}
HILL_JOIN = {"x": int(_HJ.get("x", 424)), "y": int(_HJ.get("y", 56)), "k": _HJ.get("k") or "strawMat"}


def new_hill() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "holder": None, "heldAt": None, "scores": {},
        "startedAt": None, "endedAt": None, "payouts": None, "paid": {}, "rank": [],
    }


def _hill_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def _hill_credit(rnd: dict[str, Any], now: int) -> None:
    holder = rnd.get("holder")
    held_at = rnd.get("heldAt")
    if not holder or held_at is None:
        return
    dt = max(0, now - int(held_at))
    scores = rnd.setdefault("scores", {})
    scores[holder] = int(scores.get(holder) or 0) + dt
    rnd["heldAt"] = now


def _hill_go_live(rnd: dict[str, Any], now: int) -> None:
    rnd["status"] = "live"
    rnd["startedAt"] = now
    rnd["holder"] = None
    rnd["heldAt"] = None
    for uid in rnd["order"]:
        rnd.setdefault("scores", {})[uid] = int(rnd.get("scores", {}).get(uid) or 0)


def settle_hill(rnd: dict[str, Any], now: int) -> None:
    _hill_credit(rnd, now)
    scores = rnd.get("scores") or {}
    ranking = sorted(rnd["order"], key=lambda u: (-int(scores.get(u) or 0), rnd["order"].index(u)))
    payouts = {uid: (HILL_PAYOUT[i] if i < len(HILL_PAYOUT) else HILL_REST) for i, uid in enumerate(ranking)}
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking


def maybe_expire_hill(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + HILL_COUNTDOWN_MS
        if now < live_at:
            return rnd
        _hill_go_live(rnd, live_at)
    if rnd.get("status") != "live":
        return rnd
    if now - (rnd.get("startedAt") or 0) >= HILL_ROUND_MS:
        settle_hill(rnd, now)
    return rnd


def hill_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_hill(rnd, now) or new_hill()
    players = [{
        "id": uid, "name": rnd["players"][uid]["name"],
        "holder": rnd.get("holder") == uid,
        "score": int((rnd.get("scores") or {}).get(uid) or 0),
    } for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players, "holder": rnd.get("holder"),
        "heldAt": rnd.get("heldAt"),
        "scores": dict(rnd.get("scores") or {}),
        "startedAt": rnd.get("startedAt"), "endedAt": rnd.get("endedAt"),
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": HILL_MIN, "max": HILL_MAX,
        "countdownMs": HILL_COUNTDOWN_MS, "roundMs": HILL_ROUND_MS,
        "join": dict(HILL_JOIN),
    }


def hill_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = hill_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    return v


def hill_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _hill_fail("bad_message", "無效的玩家")
    cur = new_hill() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_hill_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_hill_fail("hill_live", "占席已經開始了"), "round": cur}
    if len(cur["order"]) >= HILL_MAX:
        return {**_hill_fail("hill_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16]}
    cur["order"].append(uid)
    if len(cur["order"]) >= HILL_MAX:
        _hill_go_live(cur, now)
    elif len(cur["order"]) >= HILL_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def _hill_near(x: Any, y: Any) -> dict[str, Any] | None:
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return _hill_fail("bad_message", "位置不對")
    if math.hypot(float(x) - HILL_JOIN["x"], float(y) - HILL_JOIN["y"]) > HILL_REACH:
        return _hill_fail("too_far", "再走近草席一點")
    return None


def hill_take(rnd: dict[str, Any] | None, uid: str, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _hill_fail("hill_none", "現在沒有占席")
    maybe_expire_hill(rnd, now)
    if rnd["status"] == "over":
        return {**_hill_fail("hill_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_hill_fail("not_live", "還沒開始，先去東北草席報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_hill_fail("not_in_hill", "你不在這一輪"), "round": rnd}
    if rnd.get("holder") == uid:
        return {**_hill_fail("already_holding", "草席已經是你的"), "round": rnd}
    bad = _hill_near(x, y)
    if bad:
        bad["round"] = rnd
        return bad
    _hill_credit(rnd, now)
    rnd["holder"] = uid
    rnd["heldAt"] = now
    return {"ok": True, "round": rnd, "holder": uid}


def hill_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _hill_fail("hill_none", "現在沒有占席")
    maybe_expire_hill(rnd, now)
    if rnd["status"] == "over":
        return {**_hill_fail("hill_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_hill_fail("not_in_hill", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_hill_fail("hill_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < HILL_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_hill_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 廣場砸罐（與前端 src/game/smash.js 相同） ----------
_SM = RULES.get("smash") or {}
SMASH_MIN = int(_SM.get("min", 3))
SMASH_MAX = int(_SM.get("max", 8))
SMASH_REACH = int(_SM.get("reach", 20))
SMASH_COUNTDOWN_MS = int(_SM.get("countdownMs", 9000))
SMASH_ROUND_MS = int(_SM.get("roundMs", 45000))
SMASH_UP_MS = int(_SM.get("upMs", 1800))
SMASH_DOWN_MS = int(_SM.get("downMs", 1200))
SMASH_PAYOUT = list(_SM.get("payout") or [40, 20, 10])
SMASH_REST = int(_SM.get("restPay", 5))
_SJ = _SM.get("join") or {}
SMASH_JOIN = {"x": int(_SJ.get("x", 312)), "y": int(_SJ.get("y", 256)), "k": _SJ.get("k") or "jarRed"}


def new_smash() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "scores": {}, "lastHit": {},
        "startedAt": None, "endedAt": None, "payouts": None, "paid": {}, "rank": [],
    }


def _smash_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def smash_pop(rnd: dict[str, Any] | None, now: int) -> int:
    if not rnd or rnd.get("status") != "live":
        return -1
    t = max(0, now - int(rnd.get("startedAt") or 0))
    cycle = SMASH_UP_MS + SMASH_DOWN_MS
    return t // cycle


def smash_up(rnd: dict[str, Any] | None, now: int) -> bool:
    if not rnd or rnd.get("status") != "live":
        return False
    t = max(0, now - int(rnd.get("startedAt") or 0))
    cycle = SMASH_UP_MS + SMASH_DOWN_MS
    return (t % cycle) < SMASH_UP_MS


def _smash_go_live(rnd: dict[str, Any], now: int) -> None:
    rnd["status"] = "live"
    rnd["startedAt"] = now
    rnd["lastHit"] = {}
    for uid in rnd["order"]:
        rnd.setdefault("scores", {})[uid] = int(rnd.get("scores", {}).get(uid) or 0)


def settle_smash(rnd: dict[str, Any], now: int) -> None:
    scores = rnd.get("scores") or {}
    ranking = sorted(rnd["order"], key=lambda u: (-int(scores.get(u) or 0), rnd["order"].index(u)))
    payouts = {uid: (SMASH_PAYOUT[i] if i < len(SMASH_PAYOUT) else SMASH_REST) for i, uid in enumerate(ranking)}
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking


def maybe_expire_smash(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + SMASH_COUNTDOWN_MS
        if now < live_at:
            return rnd
        _smash_go_live(rnd, live_at)
    if rnd.get("status") != "live":
        return rnd
    if now - (rnd.get("startedAt") or 0) >= SMASH_ROUND_MS:
        settle_smash(rnd, now)
    return rnd


def smash_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_smash(rnd, now) or new_smash()
    players = [{
        "id": uid, "name": rnd["players"][uid]["name"],
        "score": int((rnd.get("scores") or {}).get(uid) or 0),
    } for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players,
        "scores": dict(rnd.get("scores") or {}),
        "up": smash_up(rnd, now), "pop": smash_pop(rnd, now),
        "startedAt": rnd.get("startedAt"), "endedAt": rnd.get("endedAt"),
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": SMASH_MIN, "max": SMASH_MAX,
        "countdownMs": SMASH_COUNTDOWN_MS, "roundMs": SMASH_ROUND_MS,
        "upMs": SMASH_UP_MS, "downMs": SMASH_DOWN_MS,
        "join": dict(SMASH_JOIN),
    }


def smash_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = smash_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    return v


def smash_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _smash_fail("bad_message", "無效的玩家")
    cur = new_smash() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_smash_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_smash_fail("smash_live", "砸罐已經開始了"), "round": cur}
    if len(cur["order"]) >= SMASH_MAX:
        return {**_smash_fail("smash_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16]}
    cur["order"].append(uid)
    if len(cur["order"]) >= SMASH_MAX:
        _smash_go_live(cur, now)
    elif len(cur["order"]) >= SMASH_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def _smash_near(x: Any, y: Any) -> dict[str, Any] | None:
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return _smash_fail("bad_message", "位置不對")
    if math.hypot(float(x) - SMASH_JOIN["x"], float(y) - SMASH_JOIN["y"]) > SMASH_REACH:
        return _smash_fail("too_far", "再走近紅罐一點")
    return None


def smash_hit(rnd: dict[str, Any] | None, uid: str, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _smash_fail("smash_none", "現在沒有砸罐")
    maybe_expire_smash(rnd, now)
    if rnd["status"] == "over":
        return {**_smash_fail("smash_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_smash_fail("not_live", "還沒開始，先去南岸紅罐報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_smash_fail("not_in_smash", "你不在這一輪"), "round": rnd}
    bad = _smash_near(x, y)
    if bad:
        bad["round"] = rnd
        return bad
    if not smash_up(rnd, now):
        return {**_smash_fail("not_up", "罐子還沒冒出來"), "round": rnd}
    pop = smash_pop(rnd, now)
    last = rnd.setdefault("lastHit", {})
    if uid in last and last[uid] == pop:
        return {**_smash_fail("already_hit", "這一波你已經砸過了"), "round": rnd}
    last[uid] = pop
    scores = rnd.setdefault("scores", {})
    scores[uid] = int(scores.get(uid) or 0) + 1
    return {"ok": True, "round": rnd, "pop": pop, "score": scores[uid]}


def smash_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _smash_fail("smash_none", "現在沒有砸罐")
    maybe_expire_smash(rnd, now)
    if rnd["status"] == "over":
        return {**_smash_fail("smash_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_smash_fail("not_in_smash", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_smash_fail("smash_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < SMASH_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_smash_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


# ---------- 廣場搶瓶（與前端 src/game/vase.js 相同） ----------
_VA = RULES.get("vase") or {}
VASE_MIN = int(_VA.get("min", 3))
VASE_MAX = int(_VA.get("max", 8))
VASE_REACH = int(_VA.get("reach", 20))
VASE_COUNTDOWN_MS = int(_VA.get("countdownMs", 9000))
VASE_ROUND_MS = int(_VA.get("roundMs", 45000))
VASE_PAYOUT = list(_VA.get("payout") or [40, 20, 10])
VASE_REST = int(_VA.get("restPay", 5))
VASE_WIN = int(_VA.get("winPay", 40))
VASE_LOSE = int(_VA.get("losePay", 5))
_VJ = _VA.get("join") or {}
VASE_JOIN = {"x": int(_VJ.get("x", 440)), "y": int(_VJ.get("y", 200)), "k": _VJ.get("k") or "vase"}


def new_vase() -> dict[str, Any]:
    return {
        "status": "open", "players": {}, "order": [], "team": {}, "holder": None, "heldAt": None,
        "scores": {}, "teamScore": {"red": 0, "blue": 0}, "startedAt": None, "endedAt": None,
        "payouts": None, "paid": {}, "rank": [], "winner": None,
    }


def _vase_fail(code: str, msg: str, rnd: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "msg": msg}
    if rnd is not None:
        out["round"] = rnd
    return out


def _vase_side(i: int) -> str:
    return "red" if i % 2 == 0 else "blue"


def _vase_credit(rnd: dict[str, Any], now: int) -> None:
    holder = rnd.get("holder")
    held_at = rnd.get("heldAt")
    if not holder or held_at is None:
        return
    dt = max(0, now - int(held_at))
    scores = rnd.setdefault("scores", {})
    scores[holder] = int(scores.get(holder) or 0) + dt
    side = (rnd.get("team") or {}).get(holder)
    if side:
        ts = rnd.setdefault("teamScore", {"red": 0, "blue": 0})
        ts[side] = int(ts.get(side) or 0) + dt
    rnd["heldAt"] = now


def _vase_go_live(rnd: dict[str, Any], now: int) -> None:
    rnd["status"] = "live"
    rnd["startedAt"] = now
    rnd["holder"] = None
    rnd["heldAt"] = None
    rnd["teamScore"] = {"red": 0, "blue": 0}
    for i, uid in enumerate(rnd["order"]):
        rnd.setdefault("team", {})[uid] = _vase_side(i)
        rnd.setdefault("scores", {})[uid] = int(rnd.get("scores", {}).get(uid) or 0)


def settle_vase(rnd: dict[str, Any], now: int) -> None:
    _vase_credit(rnd, now)
    ts = rnd.get("teamScore") or {}
    red, blue = int(ts.get("red") or 0), int(ts.get("blue") or 0)
    winner = "red" if red > blue else "blue" if blue > red else None
    team = rnd.get("team") or {}
    scores = rnd.get("scores") or {}

    def key(u: str) -> tuple:
        if winner:
            return (0 if team.get(u) == winner else 1, -int(scores.get(u) or 0), rnd["order"].index(u))
        return (-int(scores.get(u) or 0), rnd["order"].index(u))

    ranking = sorted(rnd["order"], key=key)
    payouts: dict[str, int] = {}
    if not winner:
        payouts = {uid: (VASE_PAYOUT[i] if i < len(VASE_PAYOUT) else VASE_REST) for i, uid in enumerate(ranking)}
    else:
        for i, uid in enumerate(ranking):
            payouts[uid] = (VASE_PAYOUT[i] if i < len(VASE_PAYOUT) else VASE_WIN) if team.get(uid) == winner else VASE_LOSE
    rnd["status"] = "over"
    rnd["endedAt"] = now
    rnd["payouts"] = payouts
    rnd["rank"] = ranking
    rnd["winner"] = winner


def maybe_expire_vase(rnd: dict[str, Any] | None, now: int) -> dict[str, Any] | None:
    if not rnd:
        return rnd
    if rnd.get("status") == "countdown":
        live_at = (rnd.get("startedAt") or 0) + VASE_COUNTDOWN_MS
        if now < live_at:
            return rnd
        _vase_go_live(rnd, live_at)
    if rnd.get("status") != "live":
        return rnd
    if now - (rnd.get("startedAt") or 0) >= VASE_ROUND_MS:
        settle_vase(rnd, now)
    return rnd


def vase_public(rnd: dict[str, Any] | None, now: int = 0) -> dict[str, Any]:
    rnd = maybe_expire_vase(rnd, now) or new_vase()
    players = [{
        "id": uid, "name": rnd["players"][uid]["name"],
        "team": (rnd.get("team") or {}).get(uid),
        "holder": rnd.get("holder") == uid,
        "score": int((rnd.get("scores") or {}).get(uid) or 0),
    } for uid in rnd["order"]]
    return {
        "status": rnd["status"], "players": players, "holder": rnd.get("holder"),
        "heldAt": rnd.get("heldAt"),
        "scores": dict(rnd.get("scores") or {}),
        "teamScore": dict(rnd.get("teamScore") or {"red": 0, "blue": 0}),
        "winner": rnd.get("winner"),
        "startedAt": rnd.get("startedAt"), "endedAt": rnd.get("endedAt"),
        "payouts": dict(rnd["payouts"]) if rnd.get("payouts") else None,
        "rank": list(rnd.get("rank") or []), "min": VASE_MIN, "max": VASE_MAX,
        "countdownMs": VASE_COUNTDOWN_MS, "roundMs": VASE_ROUND_MS,
        "join": dict(VASE_JOIN),
    }


def vase_view(rnd: dict[str, Any] | None, uid: str, now: int = 0) -> dict[str, Any]:
    v = vase_public(rnd, now)
    v["you"] = uid
    v["payout"] = (rnd.get("payouts") or {}).get(uid, 0) if rnd else 0
    return v


def vase_join(rnd: dict[str, Any] | None, uid: str, name: str, now: int) -> dict[str, Any]:
    if not isinstance(uid, str) or not uid:
        return _vase_fail("bad_message", "無效的玩家")
    cur = new_vase() if (rnd is None or rnd.get("status") == "over") else rnd
    if uid in cur["players"]:
        return {**_vase_fail("already_in", "你已經在隊伍裡"), "round": cur}
    if cur["status"] == "live":
        return {**_vase_fail("vase_live", "搶瓶已經開始了"), "round": cur}
    if len(cur["order"]) >= VASE_MAX:
        return {**_vase_fail("vase_full", "人滿了"), "round": cur}
    cur["players"][uid] = {"name": str(name or "訪客")[:16]}
    cur["order"].append(uid)
    if len(cur["order"]) >= VASE_MAX:
        _vase_go_live(cur, now)
    elif len(cur["order"]) >= VASE_MIN and cur["status"] == "open":
        cur["status"] = "countdown"
        cur["startedAt"] = now
    return {"ok": True, "round": cur}


def _vase_near(x: Any, y: Any) -> dict[str, Any] | None:
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return _vase_fail("bad_message", "位置不對")
    if math.hypot(float(x) - VASE_JOIN["x"], float(y) - VASE_JOIN["y"]) > VASE_REACH:
        return _vase_fail("too_far", "再走近花瓶一點")
    return None


def vase_take(rnd: dict[str, Any] | None, uid: str, x: Any, y: Any, now: int) -> dict[str, Any]:
    if not rnd:
        return _vase_fail("vase_none", "現在沒有搶瓶")
    maybe_expire_vase(rnd, now)
    if rnd["status"] == "over":
        return {**_vase_fail("vase_over", "這一輪已經結束"), "round": rnd}
    if rnd["status"] != "live":
        return {**_vase_fail("not_live", "還沒開始，先去東岸花瓶報名"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_vase_fail("not_in_vase", "你不在這一輪"), "round": rnd}
    if rnd.get("holder") == uid:
        return {**_vase_fail("already_holding", "花瓶已經是你的"), "round": rnd}
    holder = rnd.get("holder")
    team = rnd.get("team") or {}
    if holder and team.get(holder) == team.get(uid):
        return {**_vase_fail("already_ours", "花瓶是隊友的，守住就好"), "round": rnd}
    bad = _vase_near(x, y)
    if bad:
        bad["round"] = rnd
        return bad
    _vase_credit(rnd, now)
    rnd["holder"] = uid
    rnd["heldAt"] = now
    return {"ok": True, "round": rnd, "holder": uid}


def vase_leave(rnd: dict[str, Any] | None, uid: str, now: int) -> dict[str, Any]:
    if not rnd:
        return _vase_fail("vase_none", "現在沒有搶瓶")
    maybe_expire_vase(rnd, now)
    if rnd["status"] == "over":
        return {**_vase_fail("vase_over", "這一輪已經結束"), "round": rnd}
    if uid not in rnd["players"]:
        return {**_vase_fail("not_in_vase", "你不在這一輪"), "round": rnd}
    if rnd["status"] == "live":
        return {**_vase_fail("vase_live", "開始後就不能退出"), "round": rnd}
    del rnd["players"][uid]
    rnd["order"] = [i for i in rnd["order"] if i != uid]
    if rnd["status"] == "countdown" and len(rnd["order"]) < VASE_MIN:
        rnd["status"] = "open"
        rnd["startedAt"] = None
    return {"ok": True, "round": rnd}


def apply_vase_gold(rec: dict[str, Any], uid: str, rnd: dict[str, Any] | None) -> int:
    if not rnd or rnd.get("status") != "over" or not rnd.get("payouts"):
        return 0
    paid = rnd.setdefault("paid", {})
    if paid.get(uid):
        return 0
    n = int(rnd["payouts"].get(uid, 0) or 0)
    rec["gold"] = int(rec.get("gold") or 0) + n
    paid[uid] = n
    return n


def pack_farm(farm: dict[str, Any]) -> dict[str, Any]:
    """給前端的精簡格式（和前端 packFarm 相同，時間是秒）。"""
    xy = lambda k: [int(v) for v in k.split(",")]  # noqa: E731
    sec = lambda ms: round(ms / 1000) if ms else 0  # noqa: E731
    return {
        "d": [[*xy(k), DEBRIS_KEYS.index(d["t"]), d["hp"], d["look"]] for k, d in farm["debris"].items()],
        "t": [[*xy(k), sec(t.get("w", 0))] for k, t in farm["tilled"].items()],
        "c": [[*xy(k), CROP_KEYS.index(c["t"]), c["s"], sec(c.get("w", 0))] for k, c in farm["crops"].items()],
    }
