"""鎮民好感：每天可以送每位鎮民一份禮物，累積心數（0–10）。到 2、4、6、8、10 心會回禮，10 心得到稱號。
清單（名字、最愛、喜歡）要和前端 src/game/friends.js 一致（測試會比對）。
"""

from __future__ import annotations

from typing import Any

FRIENDS: dict[str, dict[str, Any]] = {
    "grandpa": {"name": "皮爺爺", "loves": ["pie_pumpkin", "fish_catfish"], "likes": ["wheat", "carrot", "pie_carrot"]},
    "mary": {"name": "瑪莉", "loves": ["pie_strawberry", "strawberry"], "likes": ["wheat", "pie_beet", "pie_carrot"]},
    "chubby": {"name": "阿胖", "loves": ["pie_tomato", "fish_tuna"], "likes": ["beet", "tomato", "pie_pumpkin"]},
    "clint": {"name": "克林", "loves": ["stone", "fish_puffer"], "likes": ["wood", "pie_carrot"]},
    "robin": {"name": "蘿蘋", "loves": ["wood", "pie_strawberry"], "likes": ["fiber", "pumpkin"]},
    "doc": {"name": "哈醫生", "loves": ["pie_beet", "fish_trout"], "likes": ["carrot", "beet"]},
    "nicole": {"name": "妮可", "loves": ["fish_golden", "pie_strawberry"], "likes": ["strawberry", "tomato"]},
    "mayor": {"name": "路易斯鎮長", "loves": ["pie_pumpkin", "pumpkin"], "likes": ["fish_bass", "pie_tomato"]},
    "kid": {"name": "小傑", "loves": ["strawberry", "pie_strawberry"], "likes": ["fish_sardine", "carrot"]},
    "granny": {"name": "艾芙琳奶奶", "loves": ["pie_carrot", "fish_carp"], "likes": ["pie_pumpkin", "wheat"]},
    "sam": {"name": "山姆", "loves": ["fish_shrimp", "pie_tomato"], "likes": ["tomato", "fish_octopus"]},
    "foreman": {"name": "工頭阿土", "loves": ["pie_pumpkin", "stone"], "likes": ["wood", "fiber"]},
}
POINTS = {"love": 80, "like": 45, "ok": 20}
PER_HEART = 100
MAX_HEARTS = 10
TIERS = {2: 50, 4: 100, 6: 150, 8: 200, 10: 300}      # 到幾心回禮多少金幣


def hearts(points: int) -> int:
    return min(MAX_HEARTS, max(0, int(points)) // PER_HEART)


def taste(npc: str, item: str) -> str:
    f = FRIENDS[npc]
    return "love" if item in f["loves"] else "like" if item in f["likes"] else "ok"


def state(rec: dict[str, Any]) -> dict[str, Any]:
    st = rec.get("npc")
    if not isinstance(st, dict):
        st = rec["npc"] = {}
    return st


def gift(rec: dict[str, Any], npc: Any, item: Any, day: str, items: set[str]) -> dict[str, Any]:
    if npc not in FRIENDS:
        return {"ok": False, "code": "bad_npc", "msg": "沒有這位鎮民"}
    if not isinstance(item, str) or item not in items or rec["inv"].get(item, 0) <= 0:
        return {"ok": False, "code": "no_item", "msg": "背包裡沒有這個"}
    st = state(rec)
    me = st.setdefault(npc, {"p": 0, "day": ""})
    if me.get("day") == day:
        return {"ok": False, "code": "gifted", "msg": f"今天已經送過{FRIENDS[npc]['name']}了，明天再來"}
    rec["inv"][item] -= 1
    if not rec["inv"][item]:
        del rec["inv"][item]
    before = hearts(me["p"])
    t = taste(npc, item)
    me["p"] = min(MAX_HEARTS * PER_HEART, me["p"] + POINTS[t])
    me["day"] = day
    after = hearts(me["p"])
    gold = sum(g for h, g in TIERS.items() if before < h <= after)
    rec["gold"] += gold
    title = None
    if after >= MAX_HEARTS > before:
        title = f"{FRIENDS[npc]['name']}的好朋友"
        titles = rec.setdefault("titles", [])
        if title not in titles:
            titles.append(title)
    return {"ok": True, "taste": t, "hearts": after, "up": after > before, "reward": gold, "title": title}


def view(rec: dict[str, Any], day: str) -> dict[str, Any]:
    st = state(rec)
    return {k: {"hearts": hearts((st.get(k) or {}).get("p", 0)), "p": (st.get(k) or {}).get("p", 0) % PER_HEART,
                "today": (st.get(k) or {}).get("day") == day} for k in FRIENDS}


def counts(rec: dict[str, Any]) -> tuple[int, int]:
    """(最高心數, 五心以上的人數)：集章用。"""
    hs = [hearts(v.get("p", 0)) for v in state(rec).values() if isinstance(v, dict)]
    return (max(hs, default=0), sum(1 for h in hs if h >= 5))
