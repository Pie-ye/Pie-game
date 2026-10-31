"""派派鎮的集章手冊與每日委託（純邏輯，伺服器專用）。

各種動作呼叫 note(rec, events, day) 回報進度：events 是 [(kind, n)]，kind 例如 'harvest'、'fish:golden'、
'arena_coin_best'（以 _best 結尾的是「最高紀錄」，取最大值而不是累加）。
回傳這次新完成的項目，獎金已經加進 rec['gold']。

資料：
  rec['prog']   = {kind: 累計或最高紀錄}
  rec['uniq']   = {集合名: [值...]}（收集類：作物種類、魚種、拜訪過的家、玩過的派對）
  rec['stamps'] = {stamp_id: 取得時間 ms}
  rec['daily']  = {'day': 'YYYY-MM-DD', 'n': {kind: 今天的數量}, 'done': [索引], 'bonus': bool}
"""

from __future__ import annotations

import hashlib
from typing import Any

UNIQ_MAX = 200

# (id, 類別, 名稱, 說明, 條件 kind, 門檻, 獎金)
STAMPS: list[tuple[str, str, str, str, str, int, int]] = [
    ("farm_first", "farm", "第一次收成", "收成任何一個作物", "harvest", 1, 20),
    ("farm_50", "farm", "豐收", "累計收成 50 個作物", "harvest", 50, 80),
    ("farm_all", "farm", "六色菜園", "六種作物都收成過", "uniq:crop", 6, 120),
    ("farm_clear", "farm", "開墾者", "累計清除 100 個雜物", "clear", 100, 60),
    ("farm_ship", "farm", "出貨大戶", "累計出貨 1000 G", "ship_gold", 1000, 80),
    ("fish_first", "fish", "第一條魚", "釣到任何一條魚", "fish", 1, 20),
    ("fish_30", "fish", "老練釣手", "累計釣到 30 條魚", "fish", 30, 60),
    ("fish_all", "fish", "魚類圖鑑", "八種魚都釣過", "uniq:fish", 8, 150),
    ("fish_golden", "fish", "金色傳說", "釣到金色鯉魚", "fish:golden", 1, 80),
    ("fish_pier", "fish", "碼頭漁獲", "在海釣碼頭釣到章魚和大蝦", "uniq:pierfish", 2, 80),
    ("fish_contest", "fish", "釣魚大賽前三", "在釣魚大賽拿到前三名", "contest_top3", 1, 60),
    ("party_first", "party", "派對新手", "玩完一場廣場常駐派對", "party_play", 1, 20),
    ("party_all", "party", "派對全制霸", "九種廣場派對都玩過", "uniq:party", 9, 150),
    ("party_win5", "party", "派對常勝軍", "廣場派對拿到 5 次第一名", "party_win", 5, 80),
    ("arena_first", "party", "初登場", "完成一場派派大作戰", "arena_play", 1, 20),
    ("arena_crown", "party", "戴上皇冠", "派派大作戰奪冠", "arena_win", 1, 60),
    ("arena_crown10", "party", "皇冠收藏家", "派派大作戰奪冠 10 次", "arena_win", 10, 200),
    ("arena_coin30", "party", "金幣雨達人", "金幣雨單回合 30 分以上", "arena_coin_best", 30, 60),
    ("arena_hit10", "party", "神射手", "派餅大戰單回合打中 10 次", "arena_hit_best", 10, 60),
    ("arena_quiz5", "party", "問答王", "派派問答一回合全部答對", "arena_quiz_best", 5, 60),
    ("arena_survivor", "party", "最後站著的人", "落地板撐到最後", "arena_floor_survive", 1, 60),
    ("arena_crowd", "party", "熱鬧的一場", "和另外兩位以上的真人一起打派派大作戰", "arena_humans3", 1, 80),
    ("boss_first", "party", "餵飽大胃王", "大胃王蛙被餵飽時你有丟中", "boss_feed", 1, 40),
    ("boss_10", "party", "蛙蛙保母", "大胃王蛙被餵飽 10 次（你都有份）", "boss_feed", 10, 150),
    ("boss_top", "party", "最佳餵食員", "在一次餵食中丟進最多", "boss_top", 1, 80),
    ("social_like5", "social", "熱情鄰居", "稱讚 5 次別人的家園", "like", 5, 40),
    ("social_gift3", "social", "送禮達人", "送出 3 份禮物", "gift", 3, 40),
    ("social_visit10", "social", "串門子", "拜訪 10 個不同的家園", "uniq:visit", 10, 60),
    ("social_friend5", "social", "交友廣闊", "有 5 位好友", "friends_best", 5, 60),
    ("social_coop20", "social", "好幫手", "在別人的農場幫忙 20 次", "coop_help", 20, 80),
    ("social_liked10", "social", "人氣家園", "家園被稱讚 10 次", "liked_best", 10, 80),
    ("town_wish10", "town", "虔誠的人", "在菲比女神噴水池許願 10 次", "wish", 10, 40),
    ("town_feed5", "town", "瑞吉的朋友", "餵瑞吉 5 次", "feed", 5, 40),
    ("town_trade", "town", "初次交易", "在交易所完成一筆交易", "trade", 1, 30),
    ("town_sell5", "town", "攤販", "在跳蚤市場賣出 5 筆", "sell", 5, 60),
    ("town_buy3", "town", "愛逛市場", "在跳蚤市場買 3 筆", "buy", 3, 40),
    ("town_builder", "town", "新區功臣", "出力蓋好一棟全鎮工程", "town_build", 1, 60),
    ("town_top", "town", "工程總監", "在一期全鎮工程貢獻最多", "town_top", 1, 120),
]
STAMP_BY = {s[0]: s for s in STAMPS}
CATS = {
    "farm": ("🌾", "農場", "農場主"), "fish": ("🎣", "釣魚", "釣魚達人"), "party": ("🎉", "派對", "派對王"),
    "social": ("💞", "社交", "好鄰居"), "town": ("🏘️", "小鎮", "派派通"),
}
CAT_BONUS = 200

# 每日委託：(kind, 數量, 獎金, 說明)；每天挑三個不同類別的
DAILY_POOL: list[tuple[str, str, int, int, str]] = [
    ("farm", "harvest", 5, 40, "收成 5 個作物"),
    ("farm", "clear", 15, 30, "清除 15 個雜物"),
    ("farm", "ship_gold", 150, 40, "出貨 150 G 的東西"),
    ("fish", "fish", 3, 40, "釣 3 條魚"),
    ("party", "party_play", 1, 40, "玩一場廣場常駐派對"),
    ("party", "arena_play", 1, 50, "參加一場派派大作戰"),
    ("social", "like", 1, 20, "稱讚一戶鄰居的家園"),
    ("social", "water_other", 3, 30, "幫別人的作物澆 3 次水"),
    ("social", "gift", 1, 30, "送一份禮物給鎮民"),
    ("town", "wish", 1, 20, "在噴水池許一次願"),
    ("town", "feed", 1, 30, "帶魚去餵瑞吉"),
    ("town", "sell", 1, 30, "在跳蚤市場賣出一筆"),
    # 新的只能加在最後：玩家存檔裡的今日委託記的是索引
    ("party", "boss_hit", 10, 40, "丟中大胃王蛙 10 次"),
    ("town", "town_give", 1, 30, "捐一次東西給全鎮工程"),
]
DAILY_N = 3
DAILY_BONUS = 60


def daily_pick(uid: str, day: str) -> list[int]:
    """依帳號與日期決定今天的三個委託（每個類別最多一個），同一天重整不會變。"""
    h = hashlib.sha256(f"{uid}|{day}".encode()).digest()
    order = sorted(range(len(DAILY_POOL)), key=lambda i: h[i % len(h)] ^ (i * 37 & 255))
    out, cats = [], set()
    for i in order:
        if DAILY_POOL[i][0] in cats:
            continue
        out.append(i)
        cats.add(DAILY_POOL[i][0])
        if len(out) == DAILY_N:
            break
    return out


def _daily(rec: dict[str, Any], uid: str, day: str) -> dict[str, Any]:
    d = rec.get("daily")
    if not isinstance(d, dict) or d.get("day") != day:
        d = {"day": day, "pick": daily_pick(uid, day), "n": {}, "done": [], "bonus": False}
        rec["daily"] = d
    return d


def _value(rec: dict[str, Any], kind: str) -> int:
    if kind.startswith("uniq:"):
        return len(rec.get("uniq", {}).get(kind[5:], []))
    return int(rec.get("prog", {}).get(kind, 0))


def note(rec: dict[str, Any], uid: str, events: list[tuple[str, Any]], day: str, now_ms: int) -> list[dict[str, Any]]:
    """回報進度；回傳新完成的項目（已發獎金）。"""
    prog = rec.setdefault("prog", {})
    uniq = rec.setdefault("uniq", {})
    stamps = rec.setdefault("stamps", {})
    d = _daily(rec, uid, day)
    touched = set()
    for kind, n in events:
        if kind.startswith("uniq:"):
            name, _, val = kind[5:].partition("=")
            lst = uniq.setdefault(name, [])
            if val and val not in lst and len(lst) < UNIQ_MAX:
                lst.append(val)
            touched.add(f"uniq:{name}")
            continue
        n = int(n)
        if kind.endswith("_best"):
            prog[kind] = max(int(prog.get(kind, 0)), n)
        else:
            prog[kind] = int(prog.get(kind, 0)) + n
            d["n"][kind] = int(d["n"].get(kind, 0)) + n
        touched.add(kind)
    done: list[dict[str, Any]] = []
    for sid, cat, name, _desc, kind, need, gold in STAMPS:
        if sid in stamps or kind not in touched:
            continue
        if _value(rec, kind) >= need:
            stamps[sid] = now_ms
            rec["gold"] = int(rec.get("gold", 0)) + gold
            done.append({"t": "stamp", "id": sid, "name": name, "gold": gold, "cat": cat})
            members = [s[0] for s in STAMPS if s[1] == cat]
            if all(m in stamps for m in members):
                rec["gold"] += CAT_BONUS
                titles = rec.setdefault("titles", [])
                title = CATS[cat][2]
                if title not in titles:
                    titles.append(title)
                done.append({"t": "title", "name": title, "gold": CAT_BONUS, "cat": cat})
    for slot, idx in enumerate(d["pick"]):
        if slot in d["done"]:
            continue
        _cat, kind, need, gold, text = DAILY_POOL[idx]
        if kind in touched and int(d["n"].get(kind, 0)) >= need:
            d["done"].append(slot)
            rec["gold"] += gold
            done.append({"t": "daily", "name": text, "gold": gold})
    if not d["bonus"] and len(d["done"]) >= len(d["pick"]):
        d["bonus"] = True
        rec["gold"] += DAILY_BONUS
        done.append({"t": "bonus", "name": "今日委託全部完成", "gold": DAILY_BONUS})
    return done


def view(rec: dict[str, Any], uid: str, day: str) -> dict[str, Any]:
    """手冊面板要的資料。"""
    d = _daily(rec, uid, day)
    stamps = rec.get("stamps", {})
    return {
        "daily": [{"text": DAILY_POOL[i][4], "got": min(int(d["n"].get(DAILY_POOL[i][1], 0)), DAILY_POOL[i][2]), "need": DAILY_POOL[i][2],
                   "gold": DAILY_POOL[i][3], "done": slot in d["done"]} for slot, i in enumerate(d["pick"])],
        "bonus": {"gold": DAILY_BONUS, "done": d["bonus"]},
        "stamps": [{"id": sid, "cat": cat, "name": name, "desc": desc, "got": sid in stamps, "at": stamps.get(sid),
                    "have": min(_value(rec, kind), need), "need": need, "gold": gold}
                   for sid, cat, name, desc, kind, need, gold in STAMPS],
        "cats": [{"id": k, "icon": v[0], "name": v[1], "title": v[2]} for k, v in CATS.items()],
        "catBonus": CAT_BONUS,
        "titles": list(rec.get("titles", [])),
        "count": len(stamps), "total": len(STAMPS),
    }
