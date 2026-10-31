import random

from server.games import arena as A


def run(ar, now, until, dt=100, each=None):
    while now < until:
        now += dt
        ar.tick(now, dt / 1000)
        if each:
            each(now)
    return now


def test_queue_fills_bots_and_runs_full_show():
    ar = A.Arena(random.Random(1))
    assert ar.join("u1", "阿派", [0, 0, 0, 0, 0], A.DESK[0], A.DESK[1], 0) is None
    assert ar.phase == "queue"
    now = run(ar, 0, A.QUEUE_MS + 100)
    assert ar.phase == "intro"
    assert len(ar.order) == A.MIN_PLAYERS
    assert sum(1 for u in ar.order if ar.p[u]["bot"]) == 3
    assert ar.rounds[-1] == "floor" and len(set(ar.rounds[:2]) & {"coin", "pie", "quiz"}) == 2
    kinds = []

    def watch(t):
        ar.pose("u1", ar.p["u1"]["x"], ar.p["u1"]["y"], t) if "u1" in ar.p else None
        if ar.phase == "live" and (not kinds or kinds[-1] != ar.kind):
            kinds.append(ar.kind)
        if ar.phase == "final" and ar.payout_due is not None:
            watch.final = list(ar.payout_due)
            ar.payout_due = None

    now = run(ar, now, now + 200000, each=watch)
    assert kinds == ar.rounds or ar.phase == "idle"
    assert ar.phase == "idle"
    assert watch.final and watch.final[0]["id"] == "u1" or any(r["id"] == "u1" for r in watch.final)


def test_bots_actually_score_in_coin_and_pie():
    ar = A.Arena(random.Random(3))
    ar.join("u1", "阿派", None, A.DESK[0], A.DESK[1], 0)
    now = run(ar, 0, A.QUEUE_MS + 100)
    ar.rounds = ["coin", "pie", "floor"]
    ar.rd = -1
    ar._next_round(now)
    now = run(ar, now, now + A.INTRO_MS + A.COIN["ms"] + 50)
    bot_coins = [ar.p[u]["score"] for u in ar.order if ar.p[u]["bot"]]
    assert max(bot_coins) >= 5, bot_coins
    now = run(ar, now, now + A.RESULT_MS + A.INTRO_MS + A.PIE["ms"] + 200)
    assert ar.kind == "pie" and ar.phase in ("result",)
    assert sum(ar.p[u]["score"] for u in ar.order) >= 3


def test_floor_eliminates_idle_player_and_ranks_survivors():
    ar = A.Arena(random.Random(5))
    ar.join("u1", "阿派", None, A.DESK[0], A.DESK[1], 0)
    now = run(ar, 0, A.QUEUE_MS + 100)
    ar.rounds = ["coin", "pie", "floor"]
    ar.rd = 1
    ar._next_round(now)
    assert ar.kind == "floor"
    end = now + A.INTRO_MS + A.FLOOR["ms"] + 100
    while now < end and ar.phase != "result":
        now += 100
        ar.tick(now, 0.1)
        ar.pose("u1", ar.p["u1"]["x"], ar.p["u1"]["y"], now)
    assert ar.p["u1"]["out"] is not None          # 站著不動一定會掉
    assert ar.phase == "result"
    outs = sorted(ar.p[u]["gain"] for u in ar.order)
    assert outs[-1] == 10 * A.FINAL_MULT and ar.p["u1"]["gain"] < outs[-1]


def test_pose_speed_clamp_and_field():
    ar = A.Arena(random.Random(2))
    ar.join("u1", "阿派", None, A.DESK[0], A.DESK[1], 0)
    now = run(ar, 0, A.QUEUE_MS + 100)
    now = run(ar, now, now + A.INTRO_MS + 100)
    pl = ar.p["u1"]
    x0 = pl["x"]
    ar.pose("u1", x0 + 300, pl["y"], now + 100)
    assert pl["x"] - x0 < 30
    ar.pose("u1", -500, -500, now + 1100)
    assert pl["x"] >= A.FIELD[0] and pl["y"] >= A.FIELD[1]


def test_join_rules_and_abort_when_humans_leave():
    ar = A.Arena(random.Random(4))
    assert ar.join("u1", "a", None, 0, 0, 0) == "too_far"
    assert ar.join("u1", "a", None, A.DESK[0], A.DESK[1], 0) is None
    assert ar.join("u1", "a", None, A.DESK[0], A.DESK[1], 0) == "already_in"
    ar.leave("u1", 10)
    assert ar.phase == "idle"
    ar.join("u1", "a", None, A.DESK[0], A.DESK[1], 0)
    now = run(ar, 0, A.QUEUE_MS + 100)
    assert ar.join("u2", "b", None, A.DESK[0], A.DESK[1], now) == "arena_busy"
    ar.leave("u1", now)
    ar.tick(now + 100)
    assert ar.phase == "idle"
    assert any(e["k"] == "abort" for e in ar.events)


def test_pie_hit_stuns_and_scores():
    ar = A.Arena(random.Random(6))
    ar.join("u1", "a", None, A.DESK[0], A.DESK[1], 0)
    ar.join("u2", "b", None, A.DESK[0], A.DESK[1], 0)
    now = run(ar, 0, A.QUEUE_MS + 100)
    ar.rounds = ["pie", "coin", "floor"]
    ar.rd = -1
    ar._next_round(now)
    now = run(ar, now, now + A.INTRO_MS + 100)
    for u in ar.order:
        if ar.p[u]["bot"]:
            ar.p[u]["gone"] = True              # 讓 NPC 不干擾
    a, b = ar.p["u1"], ar.p["u2"]
    a.update(x=150.0, y=150.0)
    b.update(x=200.0, y=150.0)
    assert ar.throw("u1", 1, 0, now) is None
    now = run(ar, now, now + 600)
    assert a["score"] == 1 and now < b["stun"] + 1000


def test_constants_match_frontend():
    import json
    import subprocess
    from pathlib import Path
    repo = Path(__file__).resolve().parents[2]
    js = subprocess.run(["node", "--input-type=module", "-e",
                         "const m = await import('./site/games/community/pie-plaza/src/game/arena.js'); console.log(JSON.stringify(m.ARENA))"],
                        cwd=repo, capture_output=True, text=True, check=True).stdout
    a = json.loads(js)
    assert tuple(a["field"]) == A.FIELD and a["cell"] == A.CELL and a["cols"] == A.COLS and a["rows"] == A.ROWS
    assert tuple(a["desk"]) == A.DESK and a["deskReach"] == A.DESK_REACH and a["inset"] == A.INSET
    assert a["dailyPaid"] == A.DAILY_PAID and a["minPlayers"] == A.MIN_PLAYERS and a["maxPlayers"] == A.MAX_PLAYERS
    assert a["gold"] == A.GOLD_BY_RANK and a["goldRest"] == A.GOLD_REST
    js_q = subprocess.run(["node", "--input-type=module", "-e",
                           "const m = await import('./site/games/community/pie-plaza/src/game/arena.js'); console.log(JSON.stringify(Array.from({length: 66}, (_, i) => m.quadrant(i))))"],
                          cwd=repo, capture_output=True, text=True, check=True).stdout
    assert json.loads(js_q) == [A.quadrant(i) for i in range(A.COLS * A.ROWS)]


def test_review_fixes_nan_leave_and_gone_thrower():
    ar = A.Arena(random.Random(7))
    assert ar.join("u1", "a", None, float("nan"), float("nan"), 0) == "bad_message"
    ar.join("u1", "a", None, A.DESK[0], A.DESK[1], 0)
    ar.take_events()
    ar.leave("u1", 5)
    assert ar.phase == "idle" and any(e["k"] == "leave" for e in ar.events)   # 會推播給觀眾
    ar.join("u1", "a", None, A.DESK[0], A.DESK[1], 0)
    ar.join("u2", "b", None, A.DESK[0], A.DESK[1], 0)
    now = run(ar, 0, A.QUEUE_MS + 100)
    ar.rounds = ["pie", "coin", "floor"]; ar.rd = -1; ar._next_round(now)
    now = run(ar, now, now + A.INTRO_MS + 100)
    ar.leave("u1", now)
    assert ar.throw("u1", 1, 0, now) == "not_live"


def test_quiz_round_scores_right_quadrant_and_bots_answer():
    ar = A.Arena(random.Random(11))
    ar.join("u1", "a", None, A.DESK[0], A.DESK[1], 0)
    now = run(ar, 0, A.QUEUE_MS + 100)
    ar.rounds = ["quiz", "coin", "floor"]; ar.rd = -1; ar._next_round(now)
    assert ar.snapshot(now).get("Z") is None            # 開場前不洩題
    now = run(ar, now, now + A.INTRO_MS + 100)
    assert ar.kind == "quiz" and ar.phase == "live"
    right = 0
    for qi in range(A.QUIZ["n"]):
        snap = ar.snapshot(now)
        assert snap["Z"]["st"] == "ask" and snap["Z"]["ok"] is None and len(snap["Z"]["a"]) == 4
        ok = A.QUESTIONS[ar.quiz["qs"][ar.quiz["i"]]][2]
        cx, cy = A.quadrant_center(ok)
        ar.p["u1"].update(x=cx, y=cy)                    # 站到正解區
        while ar.phase == "live" and ar.quiz["i"] == qi:
            now += 100
            ar.tick(now, 0.1)
            ar.pose("u1", cx, cy, now)
        right += 1
    assert ar.phase == "result"
    assert ar.p["u1"]["score"] == A.QUIZ["n"]
    assert ar.p["u1"]["stats"]["quiz"] == A.QUIZ["n"]
    bots = [ar.p[u]["score"] for u in ar.order if ar.p[u]["bot"]]
    assert 0 < sum(bots) < 3 * A.QUIZ["n"], bots       # 鎮民會答對一些、答錯一些


def test_quadrants_split_field():
    qs = [A.quadrant(i) for i in range(A.COLS * A.ROWS)]
    assert qs.count(-1) == A.ROWS and all(qs.count(q) == (A.COLS // 2) * (A.ROWS // 2) for q in range(4))
    assert A.quadrant(0) == 0 and A.quadrant(A.COLS - 1) == 1 and A.quadrant(A.COLS * (A.ROWS - 1)) == 2
