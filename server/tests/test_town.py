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
