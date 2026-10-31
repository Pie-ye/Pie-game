from server.games import town as TW
from server.games import plaza_logic as L


def rec(gold=10_000, **inv):
    return {"gold": gold, "inv": dict(inv)}


def test_donate_caps_at_need_and_counts_points():
    st = TW.new_state()
    a = rec(wood=100, stone=5)
    r = TW.donate(st, a, "u1", "阿派", "wood", 999, L.SELL, 1)
    assert r["ok"] and r["took"] == 60 and a["inv"]["wood"] == 40 and st["got"]["wood"] == 60
    assert TW.donate(st, a, "u1", "阿派", "wood", 1, L.SELL, 2)["code"] == "enough"
    assert TW.donate(st, a, "u1", "阿派", "carrot", 1, L.SELL, 3)["code"] == "not_needed"
    assert TW.donate(st, rec(), "u2", "小菲", "stone", 3, L.SELL, 4)["code"] == "no_item"
    assert st["points"]["u1"] == 60 * TW.VALUE["wood"]


def test_finish_pays_refund_and_moves_to_next_project():
    st = TW.new_state()
    a, b = rec(), rec()
    a["inv"].update(wood=60, stone=40, fiber=40)
    b["inv"].update(wheat=30)
    TW.donate(st, a, "u1", "阿派", "wood", 60, L.SELL, 1)
    TW.donate(st, a, "u1", "阿派", "stone", 40, L.SELL, 2)
    TW.donate(st, a, "u1", "阿派", "fiber", 40, L.SELL, 3)
    TW.donate(st, b, "u2", "小菲", "wheat", 30, L.SELL, 4)
    r = TW.donate(st, b, "u2", "小菲", "gold", 1500, L.SELL, 5)
    done = r["done"]
    assert done["id"] == "greenhouse" and st["done"] == ["greenhouse"] and st["cur"] == "pier"
    by = {x["id"]: x for x in done["rewards"]}
    assert by["u2"]["top"] and by["u2"]["gold"] == min(TW.REFUND_MAX, int(by["u2"]["points"] * TW.REFUND))
    assert st["got"] == {} and st["points"] == {}


def test_fish_slot_takes_any_fish_and_sanitize_roundtrip():
    st = TW.sanitize({"done": ["greenhouse"], "cur": "pier", "got": {"wood": 5}, "points": {"u1": 30}, "names": {"u1": "a"}})
    a = rec(fish_carp=3, fish_tuna=2)
    assert TW.donate(st, a, "u1", "a", "fish_carp", 3, L.SELL, 1)["took"] == 3
    assert TW.donate(st, a, "u1", "a", "fish_tuna", 1, L.SELL, 2)["took"] == 1
    assert st["got"]["fish"] == 4 and st["got"]["wood"] == 5
    assert TW.sanitize({"done": ["nope"], "cur": "zzz"})["cur"] == "greenhouse"
    v = TW.view(st, "u1")
    assert v["cur"]["id"] == "pier" and v["done"][0]["id"] == "greenhouse" and v["cur"]["mine"] > 0


def test_farm_regrow_daily_on_free_tiles_only():
    f = L.new_farm("u5")
    f["debris"] = {}
    f["tilled"]["22,12"] = {"w": 0}
    f["crops"]["22,12"] = {"t": "wheat", "s": 0, "w": 0, "at": 0}
    assert L.regrow(f, "u5", "2027-01-01") == []              # 第一次只記日期
    assert L.regrow(f, "u5", "2027-01-01") == []
    new = L.regrow(f, "u5", "2027-01-02")
    assert len(new) == L.REGROW_PER_DAY and "22,12" not in new
    for k in new:
        x, y = map(int, k.split(","))
        assert L.in_field(x, y) and not L.is_path(x, y) and not L.in_pond(x, y)
    more = L.regrow(f, "u5", "2027-01-20")                      # 離開很久：最多補 5 天
    assert len(more) == L.REGROW_PER_DAY * L.REGROW_MAX_DAYS
    f["debris"] = {f"{i},0": {"t": "weed", "hp": 1, "look": 0} for i in range(L.REGROW_CAP)}
    assert L.regrow(f, "u5", "2027-01-21") == []                # 滿了不長


def test_pets_starter_adopt_unlock_and_match_frontend():
    import json
    import subprocess
    from pathlib import Path
    from server.games import pets as PT
    rec = {"gold": 250, "stamps": {}, "prog": {}}
    v = PT.view(rec)
    assert v["own"] == ["cat"] and v["on"] == "cat"
    assert PT.adopt(rec, "parrot")["code"] == "no_gold"
    assert PT.adopt(rec, "frog")["code"] == "locked"
    assert PT.adopt(rec, "dog")["ok"] and rec["gold"] == 50 and rec["pets"]["on"] == "dog"
    assert PT.adopt(rec, "dog")["code"] == "owned"
    rec["stamps"]["boss_first"] = 1
    assert PT.adopt(rec, "frog")["ok"] and rec["gold"] == 50
    rec["arena"] = {"wins": 1}
    assert PT.adopt(rec, "raccoon")["ok"]
    assert PT.choose(rec, "lion")["code"] == "not_owned"
    assert PT.choose(rec, None)["ok"] and rec["pets"]["on"] is None
    repo = Path(__file__).resolve().parents[2]
    js = json.loads(subprocess.run(["node", "--input-type=module", "-e",
                                    "const m = await import('./site/games/community/pie-plaza/src/game/pets.js'); console.log(JSON.stringify(m.PETS.map((p) => [p.id, p.name, p.price, p.unlock])))"],
                                   cwd=repo, capture_output=True, text=True, check=True).stdout)
    assert js == [[p["id"], p["name"], p["price"], p["unlock"]] for p in PT.PETS]


def test_guide_steps_pay_once_and_bonus():
    from server.games import quests as Q
    rec = {"gold": 0}
    out = Q.note(rec, "u1", [("clear", 3)], "2027-01-10", 1)
    assert [d["t"] for d in out if d["t"].startswith("guide")] == ["guide"]
    assert not [d for d in Q.note(rec, "u1", [("clear", 1)], "2027-01-10", 2) if d["t"] == "guide"]
    allk = [(k, n) for k, n, _t, _g in Q.GUIDE]
    out = Q.note(rec, "u1", allk, "2027-01-10", 3)
    assert any(d["t"] == "guideAll" for d in out) and len(rec["guide"]) == len(Q.GUIDE)
    v = Q.view(rec, "u1", "2027-01-10")
    assert all(g["done"] for g in v["guide"])
