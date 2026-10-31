"""寵物：領養（金幣或成就解鎖）、選擇帶在身邊的那一隻。清單要和前端 src/game/pets.js 一致。"""

from __future__ import annotations

from typing import Any

PETS: list[dict[str, Any]] = [
    {"id": "cat", "name": "小花貓", "price": 0, "unlock": None},
    {"id": "dog", "name": "小黑狗", "price": 200, "unlock": None},
    {"id": "hamster", "name": "倉鼠", "price": 200, "unlock": None},
    {"id": "pig", "name": "粉紅小豬", "price": 250, "unlock": None},
    {"id": "cat_orange", "name": "大橘貓", "price": 300, "unlock": None},
    {"id": "shiba", "name": "柴犬", "price": 300, "unlock": None},
    {"id": "parrot", "name": "藍鸚鵡", "price": 400, "unlock": None},
    {"id": "frog", "name": "小蛙蛙", "price": 0, "unlock": ["stamp", "boss_first", 1]},
    {"id": "raccoon", "name": "小浣熊", "price": 0, "unlock": ["prog", "arena_win", 1]},
    {"id": "cow", "name": "小乳牛", "price": 0, "unlock": ["prog", "town_build", 1]},
    {"id": "monkey", "name": "小猴子", "price": 0, "unlock": ["stamps", "", 15]},
    {"id": "lion", "name": "小獅王", "price": 0, "unlock": ["prog", "arena_win", 10]},
]
PET_BY = {p["id"]: p for p in PETS}


def state(rec: dict[str, Any]) -> dict[str, Any]:
    """每個人都先有一隻小花貓。"""
    st = rec.get("pets")
    if not isinstance(st, dict) or not isinstance(st.get("own"), list):
        st = rec["pets"] = {"own": ["cat"], "on": "cat"}
    st["own"] = [p for p in st["own"] if p in PET_BY] or ["cat"]
    if st.get("on") is not None and st["on"] not in st["own"]:
        st["on"] = None
    return st


def unlocked(rec: dict[str, Any], pet: dict[str, Any]) -> bool:
    u = pet["unlock"]
    if not u:
        return True
    kind, key, n = u
    if kind == "stamp":
        return key in (rec.get("stamps") or {})
    if kind == "stamps":
        return len(rec.get("stamps") or {}) >= n
    if kind == "prog":
        v = (rec.get("prog") or {}).get(key, 0)
        if key == "arena_win":                      # 舊戰績也算
            v = max(v, (rec.get("arena") or {}).get("wins", 0))
        return v >= n
    return False


def adopt(rec: dict[str, Any], pid: Any) -> dict[str, Any]:
    pet = PET_BY.get(pid) if isinstance(pid, str) else None
    if pet is None:
        return {"ok": False, "code": "bad_pet", "msg": "沒有這隻寵物"}
    st = state(rec)
    if pid in st["own"]:
        return {"ok": False, "code": "owned", "msg": "已經是你的寵物了"}
    if not unlocked(rec, pet):
        return {"ok": False, "code": "locked", "msg": "還沒達成領養條件"}
    if rec["gold"] < pet["price"]:
        return {"ok": False, "code": "no_gold", "msg": "金幣不夠"}
    rec["gold"] -= pet["price"]
    st["own"].append(pid)
    st["on"] = pid
    return {"ok": True, "pet": pid}


def choose(rec: dict[str, Any], pid: Any) -> dict[str, Any]:
    st = state(rec)
    if pid is None:
        st["on"] = None
        return {"ok": True}
    if pid not in st["own"]:
        return {"ok": False, "code": "not_owned", "msg": "還沒有這隻寵物"}
    st["on"] = pid
    return {"ok": True}


def view(rec: dict[str, Any]) -> dict[str, Any]:
    st = state(rec)
    return {"own": list(st["own"]), "on": st["on"],
            "list": [{"id": p["id"], "name": p["name"], "price": p["price"], "owned": p["id"] in st["own"], "unlocked": unlocked(rec, p)} for p in PETS]}
