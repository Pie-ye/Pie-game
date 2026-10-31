import random

from server.games import boss as B


def taipei_ms(h, m, s=0):
    # 2027-01-15 00:00 台北 = 2027-01-14 16:00 UTC
    base = 1_800_000_000_000 - (1_800_000_000_000 + B.TZ) % 86_400_000
    return base + ((h * 60 + m) * 60 + s) * 1000


def test_schedule_window_and_next_start():
    t = taipei_ms(12, 31)
    start, end = B.window(t)
    assert start == taipei_ms(12, B.MINUTE) and end == start + B.STAY_MS
    assert B.next_start(taipei_ms(12, 10)) == taipei_ms(12, B.MINUTE)
    assert B.next_start(taipei_ms(12, B.MINUTE) + B.STAY_MS + 1) == taipei_ms(13, B.MINUTE)


def run(b, now, ms, each=None):
    end = now + ms
    while now < end and b.active:
        now += 100
        if each:
            each(now)
        b.tick(now, 0.1)
    return now


def test_feeding_fills_and_pays_with_mouth_bonus():
    b = B.Boss(random.Random(1))
    now = 1_000_000
    b.start(now, now + B.STAY_MS, 1)
    assert b.need == B.NEED_BASE and len([p for p in b.p.values() if p["bot"]]) == 3
    b.pose("u1", "阿派", 240, 250, now)
    b.phase = "mouth"; b.phase_end = now + 3000
    pl = b.p["u1"]
    assert b.throw("u1", "阿派", b.x - pl["x"], b.y - 24 - (pl["y"] - 6), now) is None
    for _ in range(12):
        now += 100
        b.tick(now, 0.1)
    assert b.fans["u1"]["fed"] == B.MOUTH_BONUS
    b.fed = b.need
    b.tick(now + 100, 0.1)
    assert b.result == "fed" and b.reward_due and b.reward_due[0]["gold"] == B.GOLD_BASE + 1 and b.reward_due[0]["top"]
    now = run(b, now + 100, B.PHASES["sleep"] + 500)
    assert not b.active and any(e["k"] == "gone" for e in b.events)


def test_escape_gives_consolation_only_to_real_feeders():
    b = B.Boss(random.Random(2))
    now = 2_000_000
    b.start(now, now + 1000, 2)
    b.fans = {"u1": {"name": "a", "hits": 3, "throws": 5, "fed": 3}, "u2": {"name": "b", "hits": 1, "throws": 1, "fed": 1}}
    b.tick(now + 1100, 0.1)
    assert b.result == "left"
    gold = {r["id"]: r["gold"] for r in b.reward_due}
    assert gold == {"u1": B.CONSOLATION, "u2": 0}


def test_croak_stuns_only_after_warning_and_helpers_feed():
    b = B.Boss(random.Random(3))
    now = 3_000_000
    b.start(now, now + B.STAY_MS, 1)
    b.pose("u1", "a", b.x + 10, b.y, now)
    b.phase = "croakWarn"; b.phase_end = now + 500
    b.tick(now + 100, 0.1)
    assert b.p["u1"]["stun"] == 0, "預警期間還不會暈"
    b.tick(now + 600, 0.1)
    assert b.p["u1"]["stun"] > now
    assert b.throw("u1", "a", 1, 0, now + 700) == "stunned"
    fed0 = b.fed
    run(b, now + 700, 60000, each=lambda t: b.pose("u1", "a", 60, 260, t))
    assert b.fed > fed0 + 10, "三位鎮民會幫忙餵"
