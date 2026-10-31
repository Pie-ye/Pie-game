"""全鎮工程：大家捐材料與金幣，一起蓋「派派新區」的建築；蓋好後全鎮都受益。

一次只蓋一棟（PROJECTS 依序）。捐獻按價值算貢獻點；完工時每位出過力的人依貢獻拿回饋金，貢獻最多的人另有一枚章。
全伺服器共用一份狀態（PlazaService 存在 plaza_exchange 表的 'town' 鍵）。
"""

from __future__ import annotations

from typing import Any

PROJECTS: list[dict[str, Any]] = [
    {"id": "greenhouse", "name": "派派溫室", "effect": "全鎮的作物長得快 25%",
     "need": {"wood": 60, "stone": 40, "fiber": 40, "wheat": 30, "gold": 1500}},
    {"id": "pier", "name": "海釣碼頭", "effect": "新區南岸可以釣魚，有章魚和大蝦",
     "need": {"wood": 100, "stone": 60, "fish": 20, "gold": 2000}},
    {"id": "fireworks", "name": "煙火台", "effect": "每晚 21:00 在廣場放煙火，看煙火的人都有小禮物",
     "need": {"fiber": 80, "pumpkin": 20, "strawberry": 20, "gold": 3000}},
]
# 三棟都蓋好後：每週一期的「週末嘉年華」，本週完成就全鎮受益到週日，下週重新籌備
CARNIVAL = {"id": "carnival", "name": "週末嘉年華", "effect": "本週全鎮派對獎金 +25%、出貨 +10%",
            "need": {"wheat": 40, "pie": 10, "fish": 15, "fiber": 30, "gold": 2500}}
PROJECT_BY = {p["id"]: p for p in PROJECTS}
PROJECT_BY["carnival"] = CARNIVAL
NAMES = {"pie": "任何派", "wood": "木材", "stone": "石頭", "fiber": "纖維", "fish": "任何魚", "gold": "金幣",
         "wheat": "小麥", "carrot": "紅蘿蔔", "beet": "甜菜", "tomato": "番茄", "strawberry": "草莓", "pumpkin": "南瓜"}
VALUE = {"wood": 6, "stone": 6, "fiber": 4, "fish": 40, "pie": 120, "gold": 1}
REFUND = 0.15            # 完工回饋：貢獻點的 15% 換成金幣
REFUND_MAX = 400
LOG_MAX = 20


def new_state() -> dict[str, Any]:
    return {"done": [], "cur": PROJECTS[0]["id"], "got": {}, "points": {}, "names": {}, "log": []}


def sanitize(raw: Any) -> dict[str, Any]:
    st = new_state()
    if not isinstance(raw, dict):
        return st
    st["done"] = [d for d in raw.get("done") or [] if d in PROJECT_BY and d != "carnival"]
    st["week"] = raw.get("week")
    st["carnivalDone"] = raw.get("carnivalDone")
    cur = raw.get("cur")
    st["cur"] = cur if cur in PROJECT_BY and cur not in st["done"] else next((p["id"] for p in PROJECTS if p["id"] not in st["done"]), None)
    if st["cur"] == cur:
        st["got"] = {k: int(v) for k, v in (raw.get("got") or {}).items() if isinstance(v, int)}
        st["points"] = {str(k): int(v) for k, v in (raw.get("points") or {}).items() if isinstance(v, int)}
        st["names"] = {str(k): str(v)[:20] for k, v in (raw.get("names") or {}).items()}
        st["log"] = list(raw.get("log") or [])[-LOG_MAX:]
    return st


def built(st: dict[str, Any], pid: str) -> bool:
    return pid in st.get("done", [])


def roll(st: dict[str, Any], week: str) -> bool:
    """三棟都蓋好後，每週開一期嘉年華（換週就重來）。有改變回傳 True（要存檔）。"""
    if any(p["id"] not in st["done"] for p in PROJECTS):
        return False
    if st.get("week") != week:
        st.update(week=week, cur="carnival" if st.get("carnivalDone") != week else None, got={}, points={}, names={}, log=[])
        return True
    if st.get("carnivalDone") == week and st.get("cur") is not None:
        st["cur"] = None
        return True
    return False


def carnival_on(st: dict[str, Any], week: str) -> bool:
    return st.get("carnivalDone") == week


def item_value(item: str, sell: dict[str, int]) -> int:
    if item in VALUE:
        return VALUE[item]
    return int(sell.get(item, 10))


def need_key(item: str) -> str:
    """背包裡的東西對到工程需求的哪一格（魚都算 fish）。"""
    return "fish" if item.startswith("fish_") else "pie" if item.startswith("pie_") else item


def donate(st: dict[str, Any], rec: dict[str, Any], uid: str, name: str, item: str, n: int, sell: dict[str, int], now: int) -> dict[str, Any]:
    """捐 n 個 item（或 item='gold' 捐金幣）。回傳 {ok, took, points, done?}，失敗 {ok: False, code, msg}。"""
    pid = st.get("cur")
    if not pid:
        return {"ok": False, "code": "all_built", "msg": "所有工程都蓋好了，敬請期待下一期！"}
    proj = PROJECT_BY[pid]
    key = need_key(item)
    if key not in proj["need"]:
        return {"ok": False, "code": "not_needed", "msg": f"{proj['name']}不需要這個"}
    left = proj["need"][key] - st["got"].get(key, 0)
    if left <= 0:
        return {"ok": False, "code": "enough", "msg": f"{NAMES.get(key, key)}已經夠了，謝謝！"}
    have = rec["gold"] if item == "gold" else rec["inv"].get(item, 0)
    take = min(int(n), left, have)
    if take <= 0:
        return {"ok": False, "code": "no_item", "msg": "背包裡沒有這個" if item != "gold" else "金幣不夠"}
    if item == "gold":
        rec["gold"] -= take
    else:
        rec["inv"][item] -= take
        if not rec["inv"][item]:
            del rec["inv"][item]
    st["got"][key] = st["got"].get(key, 0) + take
    pts = take * (VALUE[key] if key in ("fish", "pie") else item_value(item, sell))
    st["points"][uid] = st["points"].get(uid, 0) + pts
    st["names"][uid] = str(name)[:20]
    st["log"] = (st["log"] + [[st["names"][uid], key, take, now]])[-LOG_MAX:]
    out: dict[str, Any] = {"ok": True, "took": take, "points": pts, "key": key}
    if all(st["got"].get(k, 0) >= v for k, v in proj["need"].items()):
        out["done"] = finish(st, now)
    return out


def finish(st: dict[str, Any], now: int) -> dict[str, Any]:
    """完工：記錄、算回饋、換下一期。回傳 {id, name, rewards: [{id, name, points, gold, top}]}。"""
    pid = st["cur"]
    proj = PROJECT_BY[pid]
    pts = st["points"]
    top = max(pts.items(), key=lambda kv: kv[1])[0] if pts else None
    rewards = [{"id": u, "name": st["names"].get(u, "鎮民"), "points": p, "gold": min(REFUND_MAX, int(p * REFUND)), "top": u == top}
               for u, p in sorted(pts.items(), key=lambda kv: -kv[1])]
    if pid == "carnival":
        st["carnivalDone"] = st.get("week")
        st.update(cur=None, got={}, points={}, names={}, log=[])
    else:
        st["done"].append(pid)
        nxt = next((p["id"] for p in PROJECTS if p["id"] not in st["done"]), None)
        st.update(cur=nxt, got={}, points={}, names={}, log=[])
    return {"id": pid, "name": proj["name"], "effect": proj["effect"], "rewards": rewards, "at": now}


def view(st: dict[str, Any], uid: str) -> dict[str, Any]:
    pid = st.get("cur")
    cur = None
    if pid:
        proj = PROJECT_BY[pid]
        ranking = sorted(st["points"].items(), key=lambda kv: -kv[1])
        cur = {"id": pid, "name": proj["name"], "effect": proj["effect"],
               "need": [{"k": k, "name": NAMES.get(k, k), "need": v, "got": min(v, st["got"].get(k, 0))} for k, v in proj["need"].items()],
               "top": [[st["names"].get(u, "鎮民"), p] for u, p in ranking[:10]],
               "mine": st["points"].get(uid, 0), "log": st["log"][-8:]}
    done = [{"id": d, "name": PROJECT_BY[d]["name"], "effect": PROJECT_BY[d]["effect"]} for d in st["done"]]
    if st.get("carnivalDone") and st.get("carnivalDone") == st.get("week"):
        done.append({"id": "carnival", "name": f"本週{CARNIVAL['name']}", "effect": CARNIVAL["effect"]})
    return {"done": done, "weekly": all(p["id"] in st["done"] for p in PROJECTS),
            "cur": cur, "next": [{"id": p["id"], "name": p["name"]} for p in PROJECTS if p["id"] not in st["done"] and p["id"] != pid]}


def progress(st: dict[str, Any]) -> float:
    """目前工程完成度 0–1（畫工地用）。"""
    pid = st.get("cur")
    if not pid:
        return 1.0
    need = PROJECT_BY[pid]["need"]
    return sum(min(v, st["got"].get(k, 0)) / v for k, v in need.items()) / len(need)
