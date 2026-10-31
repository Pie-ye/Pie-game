from __future__ import annotations

import asyncio
import json
import random
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from aiohttp import web

from server.games import plaza_logic as L
from server.games.plaza import PlazaService
from server.relay import Relay
from server.saves import SaveStore
from server.tests.test_relay import ORIGIN, FakeClock, connect_and_auth, ticket_redeemer

REPO = Path(__file__).resolve().parents[2]
G = "pie-plaza"


# ---------- 與前端規則一致 ----------
def test_rules_match_frontend() -> None:
    """同一串操作：前端 JS（farm/state.js）與伺服器 Python 的結果必須完全相同。"""
    script = r"""
    const F = await import('./site/games/community/pie-plaza/src/farm/state.js');
    const s = F.newFarm('u7'); const owner = s;
    const ops = JSON.parse(process.argv[1]); const out = [];
    for (const [tool, x, y, now] of ops) {
      F.grow(s, now);
      const r = F.useTool(s, tool, x, y, now);
      out.push(r.ok);
    }
    F.grow(s, 10_000_000);
    console.log(JSON.stringify({ ok: out, debris: s.debris, tilled: s.tilled, crops: s.crops, inv: s.inv, seeds: s.seeds }));
    """
    rec = L.new_player("u7", "x")
    k = next(iter(rec["farm"]["debris"]))
    x, y = map(int, k.split(","))
    ops = [["sickle", x, y, 1], ["pickaxe", x, y, 2], ["axe", x, y, 3], ["axe", x, y, 4], ["axe", x, y, 5], ["axe", x, y, 6],
           ["hoe", 22, 12, 10], ["seed", 22, 12, 11], ["wateringcan", 22, 12, 12], ["hoe", 19, 12, 13], ["seed", 22, 12, 14],
           ["wateringcan", 22, 12, 100_000], ["wateringcan", 22, 12, 200_000], ["sickle", 22, 12, 300_000], ["hoe", 23, 12, 1]]
    js = json.loads(subprocess.run(["node", "--input-type=module", "-e", script, json.dumps(ops)], cwd=REPO, capture_output=True,
                                   text=True, check=True).stdout)
    got = []
    for tool, tx, ty, now in ops:
        L.grow(rec["farm"], now)
        got.append(L.use_tool(rec, rec, tool, tx, ty, now)["ok"])
    L.grow(rec["farm"], 10_000_000)
    assert got == js["ok"]
    assert rec["farm"]["debris"] == js["debris"]
    assert rec["farm"]["tilled"] == js["tilled"] and rec["farm"]["crops"] == js["crops"]
    assert rec["inv"] == js["inv"] and rec["seeds"] == js["seeds"]


def test_decor_sanitize_and_import_old_saves() -> None:
    d = L.sanitize_decor({"floor": "lava", "style": "houseWood", "ext": {"roof": 99, "yard": [1, 2]}, "items": [{"k": "bedGreen", "tx": 1, "ty": 3}, {"k": "bedGreen", "tx": 1, "ty": 3}, {"k": "nuke", "tx": 2, "ty": 2}]})
    assert d["floor"] == "tan" and d["style"] == "houseWood" and d["ext"] == {"roof": 0, "wall": 0, "yard": [1, 2, 0, 0]}
    assert d["items"] == [{"k": "bedGreen", "tx": 1, "ty": 3}]
    rec = L.import_saves("u1", "阿派", {"farm": {"v": "p1", "d": [[5, 15, 1, 2, 0]], "t": [[22, 12, 1790000000]], "c": [[22, 12, 3, 2, 0]],
                                                  "inv": {"pumpkin": 2, "hack": 9}, "seeds": {"wheat": 3}, "sel": "wheat", "gold": 777},
                                         "look": {"l": [1, 2, 3, 4, 5], "at": 1}, "social": {"open": False, "likes": 4}})
    assert rec["gold"] == 777 and rec["inv"] == {"pumpkin": 2} and rec["farm"]["crops"]["22,12"]["t"] == "tomato"
    assert rec["look"] == [1, 2, 3, 4, 5] and rec["social"]["open"] is False and rec["social"]["likes"] == 4
    assert L.sanitize_look([1, 2, 3]) is None and L.sanitize_look([0, 99, 0, 0, 0]) is None


# ---------- WebSocket ----------
async def make(aiohttp_client, tmp_path, clock=None, quests=False):
    store = SaveStore(tmp_path / "s.sqlite3")
    fake = clock or FakeClock()
    if clock is None:
        fake.value = 1_800_000_000.0
    plaza = PlazaService(store, clock=fake, rng=random.Random(1))
    if not quests:                       # 其他測試要算準金幣：關掉集章與委託的獎金
        async def no_progress(*_a, **_k):
            return []
        plaza._progress = no_progress
    relay = Relay(ORIGIN, redeem=ticket_redeemer(), saves=store, plaza=plaza, clock=fake, max_messages_per_second=1000)
    app = web.Application()

    async def lifecycle(_):
        await relay.start()
        yield
        await relay.close()

    app.cleanup_ctx.append(lifecycle)
    app.router.add_get("/mp", relay.websocket_handler)
    return await aiohttp_client(app), plaza, store, fake


async def call(ws, op, **kw):
    await ws.send_json({"type": "game", "op": op, "rid": op, **kw})
    while True:
        msg = await ws.receive_json(timeout=2)
        if msg.get("rid") == op:
            return msg


async def drain(ws):
    out = []
    with pytest.raises(asyncio.TimeoutError):
        while True:
            out.append(await ws.receive_json(timeout=0.2))
    return out


@pytest.mark.asyncio
async def test_farm_actions_permissions_and_live_patches(aiohttp_client, tmp_path) -> None:
    client, plaza, _, clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    me = (await call(alice, "load"))["me"]
    assert me["gold"] == 100 and me["seeds"] == {"wheat": 15, "carrot": 5} and len(me["farm"]["d"]) > 100
    # alice 在自己的田翻土
    r = await call(alice, "tool", tool="hoe", x=22, y=12)
    assert r["result"]["ok"] and r["tile"]["22,12"]["t"] == {"w": 0}
    # bob 來拜訪：看得到這格；只能澆水
    v = await call(bob, "view", owner="alice")
    assert v["role"] == "visitor" and [22, 12, 0] in v["home"]["farm"]["t"] and "gold" not in v["home"]
    assert (await call(bob, "tool", owner="alice", tool="hoe", x=23, y=12))["code"] == "not_allowed"
    await call(alice, "view", owner="alice")
    w = await call(bob, "tool", owner="alice", tool="wateringcan", x=22, y=12)
    assert w["result"]["water"]
    patches = [m for m in await drain(alice) if m.get("op") == "patch"]
    assert patches and patches[0]["by"] == "Bob" and patches[0]["tiles"]["22,12"]["t"]["w"] > 0
    # 邀請共同耕作後 bob 什麼工具都能用，種子從 bob 扣、收成給 alice
    await call(alice, "social", coop="bob", on=True)
    assert (await call(bob, "tool", owner="alice", tool="seed", x=22, y=12))["result"]["plant"] == "wheat"
    assert plaza.players["bob"]["seeds"]["wheat"] == 14 and plaza.players["alice"]["seeds"]["wheat"] == 15
    for _ in range(3):                                     # 每階澆水＋過時間
        await call(bob, "tool", owner="alice", tool="wateringcan", x=22, y=12)
        clock.advance(46)
        L.grow(plaza.players["alice"]["farm"], plaza.now_ms())
    h = await call(bob, "tool", owner="alice", tool="sickle", x=22, y=12)
    assert h["result"]["harvest"] == "wheat" and plaza.players["alice"]["inv"]["wheat"] == 1 and "wheat" not in plaza.players["bob"]["inv"]
    # 關閉家園後 bob（不是共耕）進不去
    await call(alice, "social", coop="bob", on=False)
    await call(alice, "social", open=False)
    assert (await call(bob, "view", owner="alice"))["code"] == "home_closed"
    assert (await call(bob, "view", owner="nobody"))["code"] == "no_such_player"
    # 其他遊戲不能用 game 訊息
    other = await connect_and_auth(client, "carol", "other-game")
    await other.send_json({"type": "game", "op": "load", "rid": "x"})
    assert (await other.receive_json(timeout=1))["code"] == "bad_message"
    for ws in (alice, bob, other):
        await ws.close()


@pytest.mark.asyncio
async def test_growth_tick_pushes_to_viewers(aiohttp_client, tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("server.games.plaza.TICK_SECONDS", 0.05)
    client, plaza, _, clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    await call(alice, "load")
    await call(alice, "tool", tool="hoe", x=22, y=12)
    await call(alice, "tool", tool="seed", x=22, y=12)
    await call(alice, "tool", tool="wateringcan", x=22, y=12)
    await call(alice, "view", owner="alice")
    await drain(alice)
    clock.advance(50)
    msgs = [m for m in await drain(alice) if m.get("op") == "patch" and m.get("kind") == "grow"]
    assert msgs and msgs[0]["tiles"]["22,12"]["c"]["s"] == 1
    await alice.close()


@pytest.mark.asyncio
async def test_economy_market_and_offline_seller(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _ = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    for ws in (alice, bob, carol):
        await call(ws, "load")
    assert (await call(alice, "buy", crop="pumpkin", n=1))["seeds"]["pumpkin"] == 1
    assert (await call(alice, "buy", crop="pumpkin", n=5))["code"] == "buy_failed"
    plaza.players["alice"]["inv"] = {"tomato": 3, "fish_tuna": 1}
    shipped = await call(alice, "ship")
    assert shipped["total"] == 3 * 80 + 120 and shipped["inv"] == {}
    # 上架
    plaza.players["alice"]["inv"] = {"pumpkin": 5}
    lst = await call(alice, "sell", item="pumpkin", n=2, price=300)
    assert lst["inv"] == {"pumpkin": 3}
    assert (await call(alice, "sell", item="pumpkin", n=9, price=1))["code"] == "no_item"
    assert (await call(alice, "purchase", id=lst["listing"]["id"]))["code"] == "own_listing"
    items = (await call(bob, "market"))["items"]
    assert items[0]["sellerName"] == "Alice" and items[0]["price"] == 300
    # 賣家離線後才成交：錢照樣入帳
    await alice.close()
    await asyncio.sleep(0.05)
    plaza.players["bob"]["gold"] = 500
    plaza.players["carol"]["gold"] = 500
    lid = lst["listing"]["id"]
    r1, r2 = await asyncio.gather(call(bob, "purchase", id=lid), call(carol, "purchase", id=lid))
    winners = [r for r in (r1, r2) if r.get("ok")]
    assert len(winners) == 1, "only one buyer wins"
    assert sum(1 for r in (r1, r2) if r.get("code") == "sold_out") == 1
    buyer = "bob" if r1.get("ok") else "carol"
    assert plaza.players[buyer]["gold"] == 200 and plaza.players[buyer]["inv"]["pumpkin"] == 2
    gold_before = plaza.players["alice"]["gold"]
    await plaza.flush()
    assert gold_before == 100 - 60 + 360 + 300
    alice2 = await connect_and_auth(client, "alice", G)
    me = (await call(alice2, "load"))["me"]
    assert me["gold"] == gold_before
    sold = [m for m in store.mail_list_sync(G, "alice") if m["kind"] == "syssold"]
    assert sold and sold[0]["data"]["price"] == 300
    # 下架
    l2 = await call(alice2, "sell", item="pumpkin", n=1, price=5)
    assert (await call(bob, "unlist", id=l2["listing"]["id"]))["code"] == "sold_out"
    assert (await call(alice2, "unlist", id=l2["listing"]["id"]))["inv"]["pumpkin"] == 3
    for ws in (alice2, bob, carol):
        await ws.close()


@pytest.mark.asyncio
async def test_gifts_likes_and_forgery(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _ = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    await call(alice, "load"); await call(bob, "load")
    plaza.players["bob"]["inv"] = {"pumpkin": 1}
    g = await call(bob, "gift", to="alice", item="pumpkin")
    assert g["inv"] == {}
    assert (await call(bob, "gift", to="alice", item="pumpkin"))["code"] == "no_item"
    note = await alice.receive_json(timeout=1)
    assert note == {"type": "mail", "from": "bob", "kind": "sysgift"}
    mid = store.mail_list_sync(G, "alice")[0]["id"]
    assert (await call(alice, "claim", id=mid))["inv"] == {"pumpkin": 1}
    assert (await call(alice, "claim", id=mid))["code"] == "no_mail", "a gift can be claimed only once"
    # 玩家不能自己寄系統信偽造禮物
    await bob.send_json({"type": "mail:send", "to": "alice", "kind": "sysgift", "data": {"item": "pumpkin", "n": 99}, "rid": "f"})
    assert (await bob.receive_json(timeout=1))["code"] == "bad_mail"
    # 稱讚每天一次
    assert (await call(bob, "like", owner="alice"))["likes"] == 1
    assert (await call(bob, "like", owner="alice"))["code"] == "already_liked"
    assert (await call(alice, "like", owner="alice"))["code"] == "bad_user"
    for ws in (alice, bob):
        await ws.close()


@pytest.mark.asyncio
async def test_fishing_timing_wish_and_feed(aiohttp_client, tmp_path) -> None:
    client, plaza, _, clock = await make(aiohttp_client, tmp_path)
    ws = await connect_and_auth(client, "alice", G)
    await call(ws, "load")
    c = await call(ws, "cast", where="pond")
    assert 1500 <= c["bite"] <= 6000
    assert (await call(ws, "land", cast=c["cast"], ok=True))["code"] == "bad_timing", "landing instantly is rejected"
    c = await call(ws, "cast", where="pond")
    clock.advance(c["bite"] / 1000 + 2)
    got = await call(ws, "land", cast=c["cast"], ok=True)
    assert got["caught"] and (got["fish"] == "boot" or got["inv"].get(f"fish_{got['fish']}") == 1)
    assert (await call(ws, "land", cast=c["cast"], ok=True))["code"] == "no_cast", "one catch per cast"
    assert (await call(ws, "cast", where="moon"))["code"] == "bad_message"
    gold = plaza.players["alice"]["gold"]
    w = await call(ws, "wish")
    assert w["reward"]["kind"] in {"none", "gold", "seed", "fish"} and w["gold"] in (gold - 10, gold + 40)
    plaza.players["alice"]["inv"]["fish_carp"] = 1
    f = await call(ws, "feed", item="fish_carp")
    assert f["reward"]["kind"] == "seed" and "fish_carp" not in f["inv"]
    assert (await call(ws, "feed", item="fish_carp"))["code"] == "no_item"
    await ws.close()


@pytest.mark.asyncio
async def test_persistence_import_and_directory(aiohttp_client, tmp_path) -> None:
    store = SaveStore(tmp_path / "s.sqlite3")
    # 舊版瀏覽器上傳的雲端存檔：第一次載入時匯入
    store.put_sync(G, "alice", "farm", {"v": "p1", "d": [], "t": [], "c": [], "inv": {"beet": 4}, "seeds": {}, "sel": "wheat", "gold": 999})
    store.put_sync(G, "alice", "look", {"l": [1, 1, 1, 1, 1], "at": 5})
    plaza = PlazaService(store)
    rec = await plaza.load("alice", "阿派")
    assert rec["gold"] == 999 and rec["inv"] == {"beet": 4} and rec["look"] == [1, 1, 1, 1, 1] and rec["farm"]["debris"] == {}
    rec["gold"] = 1234
    plaza.dirty.add("alice")
    bob = await plaza.load("bob", "Bob")
    bob["social"]["likes"] = 9
    plaza.dirty.add("bob")
    await plaza.flush()
    again = PlazaService(store)
    assert (await again.load("alice"))["gold"] == 1234
    rows = again._read_directory()
    assert [u for u, _ in rows] == ["bob", "alice"] and rows[0][1]["likes"] == 9
    store.close()


TPE = timezone(timedelta(hours=8))


def taipei_ts(y, m, d, h, mi=0) -> float:
    return datetime(y, m, d, h, mi, tzinfo=TPE).timestamp()


def test_exchange_spread_hours_trade_and_dividend() -> None:
    assert L.spread(100) == (101, 99) and L.spread(50) == (51, 49)
    open_ms = taipei_ts(2026, 11, 2, 10) * 1000       # 週一 10:00
    shut_ms = taipei_ts(2026, 11, 2, 16) * 1000
    assert L.market_open(open_ms) and not L.market_open(shut_ms)
    rec = L.new_player("a", "A")
    rec["gold"] = 1000
    ex = L.new_exchange(open_ms)
    bought = L.apply_trade(rec, ex, "buy", "GROC", 2, open_ms)
    assert bought["ok"] and bought["paid"] == 202 and rec["shares"] == {"GROC": 2} and rec["gold"] == 798
    sold = L.apply_trade(rec, ex, "sell", "GROC", 1, open_ms)
    assert sold["ok"] and sold["got"] == 99 and rec["shares"] == {"GROC": 1} and rec["gold"] == 897
    assert L.apply_trade(rec, ex, "sell", "GROC", 9, open_ms)["code"] == "no_shares"
    assert L.apply_trade(rec, ex, "buy", "GROC", 1, shut_ms)["code"] == "closed"
    assert L.apply_trade(rec, ex, "buy", "AAPL", 1, open_ms)["code"] == "bad_ticker"
    L.note_act(ex, "GROC", 40)
    rng = random.Random(1)
    assert L.tick_exchange(ex, open_ms, rng) is False          # 第一次只鎖定時段
    later = taipei_ts(2026, 11, 2, 10, 5) * 1000
    assert L.tick_exchange(ex, later, rng) is True
    assert ex["mid"]["GROC"] > 100 and ex["act"]["GROC"] == 0
    rec["shares"] = {"GROC": 10}
    gold0 = rec["gold"]
    assert L.pay_dividend(rec, {"GROC": 100}) == 10 and rec["gold"] == gold0 + 10


@pytest.mark.asyncio
async def test_exchange_ops_activity_and_persist(aiohttp_client, tmp_path) -> None:
    client, plaza, store, clock = await make(aiohttp_client, tmp_path)
    clock.value = taipei_ts(2026, 11, 2, 10)
    plaza.ex = L.new_exchange(clock.value * 1000)
    alice = await connect_and_auth(client, "alice", G)
    await call(alice, "load")
    plaza.players["alice"]["gold"] = 1000
    q = await call(alice, "quote")
    assert q["open"] and len(q["quotes"]) == 5 and q["quotes"][0]["id"] == "GROC"
    buy = await call(alice, "trade", side="buy", ticker="GROC", n=3)
    assert buy["shares"]["GROC"] == 3 and buy["gold"] == 1000 - 3 * 101
    sell = await call(alice, "trade", side="sell", ticker="GROC", n=1)
    assert sell["shares"]["GROC"] == 2 and sell["gold"] == buy["gold"] + 99
    assert (await call(alice, "trade", side="buy", ticker="MSFT", n=1))["code"] == "bad_ticker"
    # 買種子推升雜貨指數
    plaza.ex["slot"] = L.slot_key(clock.value * 1000)
    plaza.ex["act"] = {k: 0 for k in L.TICKER_IDS}
    await call(alice, "buy", crop="wheat", n=5)
    assert plaza.ex["act"]["GROC"] == 5
    clock.value = taipei_ts(2026, 11, 2, 10, 5)
    await plaza._run_exchange(None)
    assert plaza.ex["mid"]["GROC"] != 100 or plaza.ex["act"]["GROC"] == 0
    await plaza.flush()
    again = PlazaService(store, clock=clock, rng=random.Random(1))
    assert again.ex["mid"]["GROC"] == plaza.ex["mid"]["GROC"]
    # 收盤不能買
    clock.value = taipei_ts(2026, 11, 2, 16)
    assert (await call(alice, "trade", side="buy", ticker="FISH", n=1))["code"] == "closed"
    await alice.close()


def test_party_rules_match_frontend() -> None:
    script = r"""
    const P = await import('./site/games/community/pie-plaza/src/game/party.js');
    let rnd = P.newParty();
    for (const [id, name] of [['a','A'],['b','B'],['c','C']]) rnd = P.partyJoin(rnd, id, name, 0).round;
    const early = P.partyGrab(rnd, 'a', P.PARTY.spots[0].id, P.PARTY.spots[0].x, P.PARTY.spots[0].y, 1);
    const boarded = P.partyJoin(rnd, 'd', 'D', 2);
    const boardedStatus = boarded.round.status;
    rnd = boarded.round;
    P.maybeExpire(rnd, (rnd.startedAt || 0) + P.PARTY.countdownMs);
    const fourth = P.partyJoin(rnd, 'e', 'E', (rnd.startedAt || 0) + 1);
    const grabs = [];
    [['a',0],['b',1],['c',2],['a',3],['b',4],['c',5]].forEach(([u, i]) => {
      const s = P.PARTY.spots[i];
      const r = P.partyGrab(rnd, u, s.id, s.x, s.y, P.PARTY.countdownMs + 10 + i);
      rnd = r.round;
      grabs.push([r.ok, rnd.players[u].score, rnd.status]);
    });
    const rec = { gold: 100 };
    const pay = P.applyPartyGold(rec, 'a', rnd);
    const over = P.partyGrab(rnd, 'a', P.PARTY.spots[0].id, P.PARTY.spots[0].x, P.PARTY.spots[0].y, 99);
    console.log(JSON.stringify({ third: 'countdown', early: early.code, boarded: boardedStatus, fourth: fourth.code, payouts: rnd.payouts, pay, gold: rec.gold, over: over.code, grabs }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    rnd = L.new_party()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C")):
        rnd = L.party_join(rnd, uid, name, 0)["round"]
    assert rnd["status"] == js["third"] == "countdown"
    early = L.party_grab(rnd, "a", L.PARTY_SPOTS[0]["id"], L.PARTY_SPOTS[0]["x"], L.PARTY_SPOTS[0]["y"], 1)
    boarded = L.party_join(rnd, "d", "D", 2)
    boarded_status = boarded["round"]["status"]
    rnd = boarded["round"]
    L.maybe_expire_party(rnd, (rnd.get("startedAt") or 0) + L.PARTY_COUNTDOWN_MS)
    fourth = L.party_join(rnd, "e", "E", (rnd.get("startedAt") or 0) + 1)
    grabs = []
    for i, uid in enumerate(("a", "b", "c", "a", "b", "c")):
        s = L.PARTY_SPOTS[i]
        r = L.party_grab(rnd, uid, s["id"], s["x"], s["y"], L.PARTY_COUNTDOWN_MS + 10 + i)
        rnd = r["round"]
        grabs.append([r["ok"], rnd["players"][uid]["score"], rnd["status"]])
    rec = {"gold": 100}
    pay = L.apply_party_gold(rec, "a", rnd)
    over = L.party_grab(rnd, "a", L.PARTY_SPOTS[0]["id"], L.PARTY_SPOTS[0]["x"], L.PARTY_SPOTS[0]["y"], 99)
    assert early["code"] == js["early"] == "not_live"
    assert boarded_status == js["boarded"] == "countdown"
    assert fourth["code"] == js["fourth"] == "party_live"
    assert rnd["payouts"] == js["payouts"]
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert over["code"] == js["over"] == "party_over"
    assert grabs == js["grabs"]


@pytest.mark.asyncio
async def test_party_ops_score_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    dave = await connect_and_auth(client, "dave", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    await call(dave, "load")
    g0 = plaza.players["alice"]["gold"]
    j1 = await call(alice, "party", act="join")
    j2 = await call(bob, "party", act="join")
    j3 = await call(carol, "party", act="join")
    assert j1["ok"] and j2["ok"] and j3["party"]["status"] == "countdown"
    boarded = await call(dave, "party", act="join")
    assert boarded["ok"] and boarded["party"]["status"] == "countdown"
    assert len(boarded["party"]["players"]) == 4
    _clock.value = plaza.party["startedAt"] / 1000 + L.PARTY_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "party", act="view")
    assert live["party"]["status"] == "live"
    assert (await call(dave, "party", act="join"))["code"] == "already_in"
    eve = await connect_and_auth(client, "eve", G)
    await call(eve, "load")
    assert (await call(eve, "party", act="join"))["code"] == "party_live"
    assert (await call(alice, "party", act="nope"))["code"] == "bad_message"
    spots = L.PARTY_SPOTS
    owners = ["alice", "bob", "carol", "alice", "bob", "carol"]
    last = None
    for i, uid in enumerate(owners):
        ws = { "alice": alice, "bob": bob, "carol": carol }[uid]
        s = spots[i]
        last = await call(ws, "party", act="grab", spot=s["id"], x=s["x"], y=s["y"])
        assert last.get("ok"), last
    assert last["party"]["status"] == "over"
    assert last["party"]["payouts"]["alice"] == 40
    assert plaza.players["alice"]["gold"] == g0 + 40
    assert plaza.players["bob"]["gold"] == g0 + 20
    assert plaza.players["carol"]["gold"] == g0 + 10
    assert (await call(alice, "party", act="grab", spot=spots[0]["id"], x=spots[0]["x"], y=spots[0]["y"]))["code"] == "party_over"
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await dave.close()
    await eve.close()


@pytest.mark.asyncio
async def test_party_timeout_pays_before_next_join_or_grab(aiohttp_client, tmp_path) -> None:
    client, plaza, store, clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    dave = await connect_and_auth(client, "dave", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    await call(dave, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "party", act="join"))["ok"]
    assert (await call(bob, "party", act="join"))["ok"]
    live = await call(carol, "party", act="join")
    assert live["party"]["status"] == "countdown"
    started = plaza.party["startedAt"]
    clock.value = started / 1000 + L.PARTY_COUNTDOWN_MS / 1000 + L.PARTY_ROUND_MS / 1000 + 0.05
    s = L.PARTY_SPOTS[0]
    err = await call(alice, "party", act="grab", spot=s["id"], x=s["x"], y=s["y"])
    assert err["code"] == "party_over"
    assert plaza.players["alice"]["gold"] == g0 + 40
    assert plaza.players["bob"]["gold"] == g0 + 20
    assert plaza.players["carol"]["gold"] == g0 + 10
    view = await call(alice, "party", act="view")
    assert view["ok"] and plaza.players["alice"]["gold"] == g0 + 40
    nxt = await call(dave, "party", act="join")
    assert nxt["ok"] and nxt["party"]["status"] == "open"
    assert plaza.players["alice"]["gold"] == g0 + 40
    assert plaza.players["dave"]["gold"] == g0
    await plaza.flush()
    again = PlazaService(store, clock=clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await dave.close()


def test_contest_rules_match_frontend() -> None:
    script = r"""
    const C = await import('./site/games/community/pie-plaza/src/game/contest.js');
    const noon = Date.UTC(2026, 9, 31, 4, 30);
    const end = Date.UTC(2026, 9, 31, 5, 30);
    let rnd = C.newContest();
    rnd = C.contestCatch(rnd, 'a', 'A', 'sardine', 20, noon).round;
    rnd = C.contestCatch(rnd, 'b', 'B', 'golden', 20, noon).round;
    rnd = C.contestCatch(rnd, 'c', 'C', 'tuna', 30, noon).round;
    const closed = C.contestCatch(rnd, 'd', 'D', 'bass', 10, end);
    C.maybeExpireContest(rnd, end);
    const rec = { gold: 100 };
    const pay = C.applyContestGold(rec, 'b', rnd);
    console.log(JSON.stringify({ slot: C.fishingSlot(noon), closed: closed.code, payouts: rnd.payouts, pay, gold: rec.gold, status: rnd.status }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    noon = int(taipei_ts(2026, 10, 31, 12, 30) * 1000)
    end = int(taipei_ts(2026, 10, 31, 13, 30) * 1000)
    rnd = L.new_contest()
    rnd = L.contest_catch(rnd, "a", "A", "sardine", 20, noon)["round"]
    rnd = L.contest_catch(rnd, "b", "B", "golden", 20, noon)["round"]
    rnd = L.contest_catch(rnd, "c", "C", "tuna", 30, noon)["round"]
    closed = L.contest_catch(rnd, "d", "D", "bass", 10, end)
    L.maybe_expire_contest(rnd, end)
    rec = {"gold": 100}
    pay = L.apply_contest_gold(rec, "b", rnd)
    assert js["slot"] == L.fishing_slot(noon) == "12-13"
    assert closed["code"] == js["closed"] == "contest_closed"
    assert rnd["payouts"] == js["payouts"] == {"b": 40, "c": 20, "a": 10}
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert rnd["status"] == js["status"] == "over"


@pytest.mark.asyncio
async def test_contest_ops_score_persist_and_pay_at_slot_end(aiohttp_client, tmp_path) -> None:
    client, plaza, store, clock = await make(aiohttp_client, tmp_path)
    clock.value = taipei_ts(2026, 10, 31, 12, 10)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    g0 = plaza.players["alice"]["gold"]
    scored = False
    for _ in range(12):
        c = await call(alice, "cast", where="sea")
        assert c.get("contest") is True
        clock.value += (c["bite"] + 1500) / 1000.0
        land = await call(alice, "land", cast=c["cast"], ok=True)
        if land.get("ok") and land.get("caught") and land.get("size", 0) > 0:
            assert land["board"]["players"][0]["id"] == "alice"
            scored = True
            break
    assert scored, "alice should land a scoring sea fish during the contest slot"
    r = L.contest_catch(plaza.contest, "bob", "Bob", "golden", 20, plaza.now_ms())
    plaza.contest = r["round"]
    r = L.contest_catch(plaza.contest, "carol", "Carol", "tuna", 30, plaza.now_ms())
    plaza.contest = r["round"]
    clock.value = taipei_ts(2026, 10, 31, 13, 5)
    view = await call(alice, "contest")
    assert view["ok"] and view["contest"]["status"] == "over"
    assert plaza.players["alice"]["gold"] >= g0 + 5
    assert (await call(alice, "contest"))["gold"] == plaza.players["alice"]["gold"]
    await plaza.flush()
    again = PlazaService(store, clock=clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == plaza.players["alice"]["gold"]
    await alice.close()
    await bob.close()
    await carol.close()


def test_seek_rules_match_frontend() -> None:
    script = r"""
    const S = await import('./site/games/community/pie-plaza/src/game/seek.js');
    let rnd = S.newSeek();
    for (const [id, name] of [['a','A'],['b','B'],['c','C']]) rnd = S.seekJoin(rnd, id, name, 0).round;
    const early = S.seekHide(rnd, 'b', S.SEEK.spots[0].id, S.SEEK.spots[0].x, S.SEEK.spots[0].y, 1);
    const boarded = S.seekJoin(rnd, 'd', 'D', 2);
    const boardedStatus = boarded.round.status;
    rnd = boarded.round;
    S.maybeExpireSeek(rnd, (rnd.startedAt || 0) + S.SEEK.countdownMs);
    const fourth = S.seekJoin(rnd, 'e', 'E', (rnd.startedAt || 0) + 1);
    const already = S.seekJoin(rnd, 'a', 'A', (rnd.startedAt || 0) + 2);
    const notHider = S.seekHide(rnd, 'a', S.SEEK.spots[0].id, S.SEEK.spots[0].x, S.SEEK.spots[0].y, S.SEEK.countdownMs + 10);
    const s0 = S.SEEK.spots[0], s1 = S.SEEK.spots[1];
    const hidB = S.seekHide(rnd, 'b', s0.id, s0.x, s0.y, S.SEEK.countdownMs + 12);
    const hidC = S.seekHide(rnd, 'c', s1.id, s1.x, s1.y, S.SEEK.countdownMs + 15);
    const tagged = S.seekCheck(rnd, 'a', s0.id, s0.x, s0.y, S.SEEK.countdownMs + 18);
    S.maybeExpireSeek(rnd, rnd.startedAt + S.SEEK.roundMs);
    const rec = { gold: 100 };
    const pay = S.applySeekGold(rec, 'c', rnd);
    const over = S.seekHide(rnd, 'c', s1.id, s1.x, s1.y, 99);
    console.log(JSON.stringify({ third: 'countdown', early: early.code, boarded: boardedStatus, fourth: fourth.code, already: already.code, notHider: notHider.code, hidB: hidB.ok, hidC: hidC.ok, tagged: tagged.found, seeker: rnd.seeker, payouts: rnd.payouts, pay, gold: rec.gold, over: over.code }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    rnd = L.new_seek()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C")):
        rnd = L.seek_join(rnd, uid, name, 0)["round"]
    assert rnd["status"] == js["third"] == "countdown"
    early = L.seek_hide(rnd, "b", L.SEEK_SPOTS[0]["id"], L.SEEK_SPOTS[0]["x"], L.SEEK_SPOTS[0]["y"], 1)
    boarded = L.seek_join(rnd, "d", "D", 2)
    boarded_status = boarded["round"]["status"]
    rnd = boarded["round"]
    L.maybe_expire_seek(rnd, (rnd.get("startedAt") or 0) + L.SEEK_COUNTDOWN_MS)
    fourth = L.seek_join(rnd, "e", "E", (rnd.get("startedAt") or 0) + 1)
    already = L.seek_join(rnd, "a", "A", (rnd.get("startedAt") or 0) + 2)
    not_hider = L.seek_hide(rnd, "a", L.SEEK_SPOTS[0]["id"], L.SEEK_SPOTS[0]["x"], L.SEEK_SPOTS[0]["y"], L.SEEK_COUNTDOWN_MS + 10)
    s0, s1 = L.SEEK_SPOTS[0], L.SEEK_SPOTS[1]
    hid_b = L.seek_hide(rnd, "b", s0["id"], s0["x"], s0["y"], L.SEEK_COUNTDOWN_MS + 12)
    hid_c = L.seek_hide(rnd, "c", s1["id"], s1["x"], s1["y"], L.SEEK_COUNTDOWN_MS + 15)
    tagged = L.seek_check(rnd, "a", s0["id"], s0["x"], s0["y"], L.SEEK_COUNTDOWN_MS + 18)
    L.maybe_expire_seek(rnd, rnd["startedAt"] + L.SEEK_ROUND_MS)
    rec = {"gold": 100}
    pay = L.apply_seek_gold(rec, "c", rnd)
    over = L.seek_hide(rnd, "c", s1["id"], s1["x"], s1["y"], 99)
    assert early["code"] == js["early"] == "not_live"
    assert boarded_status == js["boarded"] == "countdown"
    assert fourth["code"] == js["fourth"] == "seek_live"
    assert already["code"] == js["already"] == "already_in"
    assert not_hider["code"] == js["notHider"] == "not_hider"
    assert hid_b["ok"] is True and hid_c["ok"] is True
    assert tagged["found"] == js["tagged"] == "b"
    assert rnd["seeker"] == js["seeker"] == "b"
    assert rnd["payouts"] == js["payouts"]
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert over["code"] == js["over"] == "seek_over"


@pytest.mark.asyncio
async def test_seek_ops_tag_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    dave = await connect_and_auth(client, "dave", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    await call(dave, "load")
    g0 = plaza.players["alice"]["gold"]
    j1 = await call(alice, "seek", act="join")
    j2 = await call(bob, "seek", act="join")
    j3 = await call(carol, "seek", act="join")
    assert j1["ok"] and j2["ok"] and j3["seek"]["status"] == "countdown"
    boarded = await call(dave, "seek", act="join")
    assert boarded["ok"] and boarded["seek"]["status"] == "countdown"
    assert len(boarded["seek"]["players"]) == 4
    _clock.value = plaza.seek["startedAt"] / 1000 + L.SEEK_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "seek", act="view")
    assert live["seek"]["status"] == "live"
    assert live["seek"]["seeker"] == "alice"
    assert (await call(dave, "seek", act="join"))["code"] == "already_in"
    eve = await connect_and_auth(client, "eve", G)
    await call(eve, "load")
    assert (await call(eve, "seek", act="join"))["code"] == "seek_live"
    assert (await call(alice, "seek", act="nope"))["code"] == "bad_message"
    s0, s1 = L.SEEK_SPOTS[0], L.SEEK_SPOTS[1]
    assert (await call(alice, "seek", act="hide", spot=s0["id"], x=s0["x"], y=s0["y"]))["code"] == "not_hider"
    assert (await call(bob, "seek", act="hide", spot=s0["id"], x=s0["x"], y=s0["y"]))["ok"]
    assert (await call(carol, "seek", act="hide", spot=s1["id"], x=s1["x"], y=s1["y"]))["ok"]
    tagged = await call(alice, "seek", act="check", spot=s0["id"], x=s0["x"], y=s0["y"])
    assert tagged["ok"] and tagged["seek"]["seeker"] == "bob"
    _clock.value = plaza.seek["startedAt"] / 1000 + L.SEEK_ROUND_MS / 1000 + 0.05
    view = await call(alice, "seek", act="view")
    assert view["seek"]["status"] == "over"
    assert plaza.players["carol"]["gold"] == g0 + 40
    assert plaza.players["alice"]["gold"] == g0 + 20
    assert plaza.players["bob"]["gold"] == g0 + 10
    assert plaza.players["dave"]["gold"] == g0 + 5
    assert (await call(carol, "seek", act="hide", spot=s1["id"], x=s1["x"], y=s1["y"]))["code"] == "seek_over"
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("carol", "Carol")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await dave.close()
    await eve.close()


@pytest.mark.asyncio
async def test_seek_timeout_pays_before_next_join(aiohttp_client, tmp_path) -> None:
    client, plaza, store, clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    dave = await connect_and_auth(client, "dave", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    await call(dave, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "seek", act="join"))["ok"]
    assert (await call(bob, "seek", act="join"))["ok"]
    live = await call(carol, "seek", act="join")
    assert live["seek"]["status"] == "countdown"
    started = plaza.seek["startedAt"]
    clock.value = started / 1000 + L.SEEK_COUNTDOWN_MS / 1000 + 0.05
    s0 = L.SEEK_SPOTS[0]
    assert (await call(bob, "seek", act="hide", spot=s0["id"], x=s0["x"], y=s0["y"]))["ok"]
    clock.value = started / 1000 + L.SEEK_COUNTDOWN_MS / 1000 + L.SEEK_ROUND_MS / 1000 + 0.05
    err = await call(alice, "seek", act="hide", spot=s0["id"], x=s0["x"], y=s0["y"])
    assert err["code"] == "seek_over"
    assert plaza.players["bob"]["gold"] == g0 + 40
    assert plaza.players["alice"]["gold"] == g0 + 20
    assert plaza.players["carol"]["gold"] == g0 + 10
    view = await call(alice, "seek", act="view")
    assert view["ok"] and plaza.players["alice"]["gold"] == g0 + 20
    nxt = await call(dave, "seek", act="join")
    assert nxt["ok"] and nxt["seek"]["status"] == "open"
    assert plaza.players["bob"]["gold"] == g0 + 40
    assert plaza.players["dave"]["gold"] == g0
    await plaza.flush()
    again = PlazaService(store, clock=clock, rng=random.Random(1))
    rec = await again.load("bob", "Bob")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await dave.close()


def test_hot_rules_match_frontend() -> None:
    """同一串傳南瓜操作，前端與伺服器結果一致。"""
    script = r"""
    const H = await import('./site/games/community/pie-plaza/src/game/hot.js');
    let rnd = H.newHot();
    for (const [id, name] of [['a','A'],['b','B'],['c','C'],['d','D']]) rnd = H.hotJoin(rnd, id, name, 0).round;
    const live = rnd.startedAt + H.HOT.countdownMs;
    H.maybeExpireHot(rnd, live);
    const codes = [];
    for (const [uid, dt, near] of JSON.parse(process.argv[1])) {
      const r = H.hotTake(rnd, uid, near ? H.HOT_JOIN.x : 0, near ? H.HOT_JOIN.y : 0, live + dt);
      codes.push(r.ok ? 'ok:' + r.holder : r.code);
    }
    H.maybeExpireHot(rnd, rnd.startedAt + H.HOT.roundMs);
    console.log(JSON.stringify({ codes, payouts: rnd.payouts, hold: rnd.hold }));
    """
    ops = [["b", 10, True], ["a", 500, True], ["a", 1300, False], ["a", 1300, True], ["b", 2000, True], ["b", 2600, True],
           ["c", 2700, True], ["c", 4000, True], ["d", 5300, True]]
    js = json.loads(subprocess.run(["node", "--input-type=module", "-e", script, json.dumps(ops)], cwd=REPO,
                                   capture_output=True, text=True, check=True).stdout)
    rnd = L.new_hot()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C"), ("d", "D")):
        rnd = L.hot_join(rnd, uid, name, 0)["round"]
    live = rnd["startedAt"] + L.HOT_COUNTDOWN_MS
    L.maybe_expire_hot(rnd, live)
    codes = []
    for uid, dt, near in ops:
        r = L.hot_take(rnd, uid, L.HOT_JOIN["x"] if near else 0, L.HOT_JOIN["y"] if near else 0, live + dt)
        codes.append(f"ok:{r['holder']}" if r["ok"] else r["code"])
    L.maybe_expire_hot(rnd, rnd["startedAt"] + L.HOT_ROUND_MS)
    assert codes == js["codes"]
    assert codes[:4] == ["not_holder", "too_soon", "too_far", "ok:b"]
    assert rnd["payouts"] == js["payouts"] and rnd["hold"] == js["hold"]


@pytest.mark.asyncio
async def test_hot_ops_take_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    dave = await connect_and_auth(client, "dave", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    await call(dave, "load")
    g0 = plaza.players["alice"]["gold"]
    j1 = await call(alice, "hot", act="join")
    j2 = await call(bob, "hot", act="join")
    j3 = await call(carol, "hot", act="join")
    assert j1["ok"] and j2["ok"] and j3["hot"]["status"] == "countdown"
    boarded = await call(dave, "hot", act="join")
    assert boarded["ok"] and boarded["hot"]["status"] == "countdown"
    _clock.value = plaza.hot["startedAt"] / 1000 + L.HOT_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "hot", act="view")
    assert live["hot"]["status"] == "live"
    assert live["hot"]["holder"] == "alice"
    assert (await call(dave, "hot", act="join"))["code"] == "already_in"
    eve = await connect_and_auth(client, "eve", G)
    await call(eve, "load")
    assert (await call(eve, "hot", act="join"))["code"] == "hot_live"
    assert (await call(alice, "hot", act="nope"))["code"] == "bad_message"
    x, y = L.HOT_JOIN["x"], L.HOT_JOIN["y"]
    assert (await call(bob, "hot", act="take", x=x, y=y))["code"] == "not_holder"
    assert (await call(alice, "hot", act="take", x=x, y=y))["code"] == "too_soon"
    _clock.value += 1.3
    took = await call(alice, "hot", act="take", x=x, y=y)
    assert took["ok"] and took["hot"]["holder"] == "bob"
    _clock.value = plaza.hot["startedAt"] / 1000 + L.HOT_ROUND_MS / 1000 + 0.05
    view = await call(alice, "hot", act="view")
    assert view["hot"]["status"] == "over"
    assert plaza.players["carol"]["gold"] == g0 + 40          # 沒拿過
    assert plaza.players["dave"]["gold"] == g0 + 20
    assert plaza.players["alice"]["gold"] == g0 + 10          # 拿了 1.3 秒
    assert plaza.players["bob"]["gold"] == g0 + 5             # 時間到還拿著
    assert (await call(carol, "hot", act="take", x=x, y=y))["code"] == "hot_over"
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 10
    await alice.close()
    await bob.close()
    await carol.close()
    await dave.close()
    await eve.close()


@pytest.mark.asyncio
async def test_hot_timeout_pays_before_next_join(aiohttp_client, tmp_path) -> None:
    client, plaza, store, clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    dave = await connect_and_auth(client, "dave", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    await call(dave, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "hot", act="join"))["ok"]
    assert (await call(bob, "hot", act="join"))["ok"]
    live = await call(carol, "hot", act="join")
    assert live["hot"]["status"] == "countdown"
    started = plaza.hot["startedAt"]
    clock.value = started / 1000 + L.HOT_COUNTDOWN_MS / 1000 + 1.5
    x, y = L.HOT_JOIN["x"], L.HOT_JOIN["y"]
    assert (await call(alice, "hot", act="take", x=x, y=y))["ok"]              # 傳給 bob
    clock.value = started / 1000 + L.HOT_COUNTDOWN_MS / 1000 + L.HOT_ROUND_MS / 1000 + 0.05
    err = await call(alice, "hot", act="take", x=x, y=y)
    assert err["code"] == "hot_over"
    assert plaza.players["carol"]["gold"] == g0 + 40
    assert plaza.players["alice"]["gold"] == g0 + 20
    assert plaza.players["bob"]["gold"] == g0 + 10            # 三人局：時間到還拿著的人第三名
    view = await call(alice, "hot", act="view")
    assert view["ok"] and plaza.players["alice"]["gold"] == g0 + 20
    nxt = await call(dave, "hot", act="join")
    assert nxt["ok"] and nxt["hot"]["status"] == "open"
    assert plaza.players["alice"]["gold"] == g0 + 20
    assert plaza.players["dave"]["gold"] == g0
    await plaza.flush()
    again = PlazaService(store, clock=clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 20
    await alice.close()
    await bob.close()
    await carol.close()
    await dave.close()


def test_tug_rules_match_frontend() -> None:
    script = r"""
    const T = await import('./site/games/community/pie-plaza/src/game/tug.js');
    let rnd = T.newTug();
    for (const [id, name] of [['a','A'],['b','B'],['c','C']]) rnd = T.tugJoin(rnd, id, name, 0).round;
    const L = T.TUG.spots[0], R = T.TUG.spots[1];
    const early = T.tugPull(rnd, 'a', L.id, L.x, L.y, 1);
    T.maybeExpireTug(rnd, (rnd.startedAt || 0) + T.TUG.countdownMs);
    const fourth = T.tugJoin(rnd, 'e', 'E', (rnd.startedAt || 0) + 1);
    const already = T.tugJoin(rnd, 'a', 'A', (rnd.startedAt || 0) + 2);
    const wrong = T.tugPull(rnd, 'a', R.id, R.x, R.y, T.TUG.countdownMs + 10);
    T.tugPull(rnd, 'a', L.id, L.x, L.y, T.TUG.countdownMs + 12);
    T.tugPull(rnd, 'b', R.id, R.x, R.y, T.TUG.countdownMs + 13);
    T.tugPull(rnd, 'b', R.id, R.x, R.y, T.TUG.countdownMs + 14);
    T.maybeExpireTug(rnd, rnd.startedAt + T.TUG.roundMs);
    const rec = { gold: 100 };
    const pay = T.applyTugGold(rec, 'b', rnd);
    const over = T.tugPull(rnd, 'a', L.id, L.x, L.y, 99);
    console.log(JSON.stringify({ third: 'countdown', early: early.code, fourth: fourth.code, already: already.code, wrong: wrong.code, winner: rnd.winner, payouts: rnd.payouts, pay, gold: rec.gold, over: over.code, teamA: rnd.team.a }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    rnd = L.new_tug()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C")):
        rnd = L.tug_join(rnd, uid, name, 0)["round"]
    assert rnd["status"] == js["third"] == "countdown"
    left, right = L.TUG_SPOTS[0], L.TUG_SPOTS[1]
    early = L.tug_pull(rnd, "a", left["id"], left["x"], left["y"], 1)
    L.maybe_expire_tug(rnd, (rnd.get("startedAt") or 0) + L.TUG_COUNTDOWN_MS)
    fourth = L.tug_join(rnd, "e", "E", (rnd.get("startedAt") or 0) + 1)
    already = L.tug_join(rnd, "a", "A", (rnd.get("startedAt") or 0) + 2)
    wrong = L.tug_pull(rnd, "a", right["id"], right["x"], right["y"], L.TUG_COUNTDOWN_MS + 10)
    L.tug_pull(rnd, "a", left["id"], left["x"], left["y"], L.TUG_COUNTDOWN_MS + 12)
    L.tug_pull(rnd, "b", right["id"], right["x"], right["y"], L.TUG_COUNTDOWN_MS + 13)
    L.tug_pull(rnd, "b", right["id"], right["x"], right["y"], L.TUG_COUNTDOWN_MS + 14)
    L.maybe_expire_tug(rnd, rnd["startedAt"] + L.TUG_ROUND_MS)
    rec = {"gold": 100}
    pay = L.apply_tug_gold(rec, "b", rnd)
    over = L.tug_pull(rnd, "a", left["id"], left["x"], left["y"], 99)
    assert early["code"] == js["early"] == "not_live"
    assert fourth["code"] == js["fourth"] == "tug_live"
    assert already["code"] == js["already"] == "already_in"
    assert wrong["code"] == js["wrong"] == "wrong_side"
    assert rnd["winner"] == js["winner"] == "R"
    assert rnd["payouts"] == js["payouts"]
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert over["code"] == js["over"] == "tug_over"
    assert rnd["team"]["a"] == js["teamA"] == "L"


@pytest.mark.asyncio
async def test_tug_ops_pull_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "tug", act="join"))["ok"]
    assert (await call(bob, "tug", act="join"))["ok"]
    j3 = await call(carol, "tug", act="join")
    assert j3["tug"]["status"] == "countdown"
    _clock.value = plaza.tug["startedAt"] / 1000 + L.TUG_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "tug", act="view")
    assert live["tug"]["status"] == "live"
    assert live["tug"]["yourTeam"] == "L"
    assert (await call(alice, "tug", act="join"))["code"] == "already_in"
    eve = await connect_and_auth(client, "eve", G)
    await call(eve, "load")
    assert (await call(eve, "tug", act="join"))["code"] == "tug_live"
    left, right = L.TUG_SPOTS[0], L.TUG_SPOTS[1]
    assert (await call(alice, "tug", act="pull", side=right["id"], x=right["x"], y=right["y"]))["code"] == "wrong_side"
    assert (await call(alice, "tug", act="pull", side=left["id"], x=left["x"], y=left["y"]))["ok"]
    assert (await call(bob, "tug", act="pull", side=right["id"], x=right["x"], y=right["y"]))["ok"]
    assert (await call(bob, "tug", act="pull", side=right["id"], x=right["x"], y=right["y"]))["ok"]
    _clock.value = plaza.tug["startedAt"] / 1000 + L.TUG_ROUND_MS / 1000 + 0.05
    view = await call(alice, "tug", act="view")
    assert view["tug"]["status"] == "over"
    assert view["tug"]["winner"] == "R"
    assert plaza.players["bob"]["gold"] == g0 + 40
    assert plaza.players["alice"]["gold"] == g0 + 5
    assert plaza.players["carol"]["gold"] == g0 + 5
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("bob", "Bob")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await eve.close()


def test_haul_rules_match_frontend() -> None:
    script = r"""
    const H = await import('./site/games/community/pie-plaza/src/game/haul.js');
    let rnd = H.newHaul();
    for (const [id, name] of [['a','A'],['b','B'],['c','C']]) rnd = H.haulJoin(rnd, id, name, 0).round;
    const early = H.haulTake(rnd, 'a', H.HAUL_JOIN.x, H.HAUL_JOIN.y, 1);
    H.maybeExpireHaul(rnd, (rnd.startedAt || 0) + H.HAUL.countdownMs);
    const fourth = H.haulJoin(rnd, 'e', 'E', (rnd.startedAt || 0) + 1);
    const already = H.haulJoin(rnd, 'a', 'A', (rnd.startedAt || 0) + 2);
    const empty = H.haulDrop(rnd, 'a', H.HAUL_DROP.x, H.HAUL_DROP.y, H.HAUL.countdownMs + 10);
    H.haulTake(rnd, 'a', H.HAUL_JOIN.x, H.HAUL_JOIN.y, H.HAUL.countdownMs + 12);
    H.haulTake(rnd, 'b', H.HAUL_JOIN.x, H.HAUL_JOIN.y, H.HAUL.countdownMs + 13);
    H.haulDrop(rnd, 'b', H.HAUL_DROP.x, H.HAUL_DROP.y, H.HAUL.countdownMs + 14);
    H.haulTake(rnd, 'a', H.HAUL_JOIN.x, H.HAUL_JOIN.y, H.HAUL.countdownMs + 15);
    H.haulDrop(rnd, 'a', H.HAUL_DROP.x, H.HAUL_DROP.y, H.HAUL.countdownMs + 16);
    H.haulTake(rnd, 'a', H.HAUL_JOIN.x, H.HAUL_JOIN.y, H.HAUL.countdownMs + 17);
    H.haulDrop(rnd, 'a', H.HAUL_DROP.x, H.HAUL_DROP.y, H.HAUL.countdownMs + 18);
    H.maybeExpireHaul(rnd, rnd.startedAt + H.HAUL.roundMs);
    const rec = { gold: 100 };
    const pay = H.applyHaulGold(rec, 'a', rnd);
    const over = H.haulTake(rnd, 'a', H.HAUL_JOIN.x, H.HAUL_JOIN.y, 99);
    console.log(JSON.stringify({ third: 'countdown', early: early.code, fourth: fourth.code, already: already.code, empty: empty.code, payouts: rnd.payouts, pay, gold: rec.gold, over: over.code, scores: rnd.scores }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    rnd = L.new_haul()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C")):
        rnd = L.haul_join(rnd, uid, name, 0)["round"]
    assert rnd["status"] == js["third"] == "countdown"
    early = L.haul_take(rnd, "a", L.HAUL_JOIN["x"], L.HAUL_JOIN["y"], 1)
    L.maybe_expire_haul(rnd, (rnd.get("startedAt") or 0) + L.HAUL_COUNTDOWN_MS)
    fourth = L.haul_join(rnd, "e", "E", (rnd.get("startedAt") or 0) + 1)
    already = L.haul_join(rnd, "a", "A", (rnd.get("startedAt") or 0) + 2)
    empty = L.haul_drop(rnd, "a", L.HAUL_DROP["x"], L.HAUL_DROP["y"], L.HAUL_COUNTDOWN_MS + 10)
    L.haul_take(rnd, "a", L.HAUL_JOIN["x"], L.HAUL_JOIN["y"], L.HAUL_COUNTDOWN_MS + 12)
    L.haul_take(rnd, "b", L.HAUL_JOIN["x"], L.HAUL_JOIN["y"], L.HAUL_COUNTDOWN_MS + 13)
    L.haul_drop(rnd, "b", L.HAUL_DROP["x"], L.HAUL_DROP["y"], L.HAUL_COUNTDOWN_MS + 14)
    L.haul_take(rnd, "a", L.HAUL_JOIN["x"], L.HAUL_JOIN["y"], L.HAUL_COUNTDOWN_MS + 15)
    L.haul_drop(rnd, "a", L.HAUL_DROP["x"], L.HAUL_DROP["y"], L.HAUL_COUNTDOWN_MS + 16)
    L.haul_take(rnd, "a", L.HAUL_JOIN["x"], L.HAUL_JOIN["y"], L.HAUL_COUNTDOWN_MS + 17)
    L.haul_drop(rnd, "a", L.HAUL_DROP["x"], L.HAUL_DROP["y"], L.HAUL_COUNTDOWN_MS + 18)
    L.maybe_expire_haul(rnd, rnd["startedAt"] + L.HAUL_ROUND_MS)
    rec = {"gold": 100}
    pay = L.apply_haul_gold(rec, "a", rnd)
    over = L.haul_take(rnd, "a", L.HAUL_JOIN["x"], L.HAUL_JOIN["y"], 99)
    assert early["code"] == js["early"] == "not_live"
    assert fourth["code"] == js["fourth"] == "haul_live"
    assert already["code"] == js["already"] == "already_in"
    assert empty["code"] == js["empty"] == "empty_hands"
    assert rnd["payouts"] == js["payouts"]
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert over["code"] == js["over"] == "haul_over"
    assert rnd["scores"] == js["scores"]


@pytest.mark.asyncio
async def test_haul_ops_take_drop_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "haul", act="join"))["ok"]
    assert (await call(bob, "haul", act="join"))["ok"]
    j3 = await call(carol, "haul", act="join")
    assert j3["haul"]["status"] == "countdown"
    _clock.value = plaza.haul["startedAt"] / 1000 + L.HAUL_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "haul", act="view")
    assert live["haul"]["status"] == "live"
    assert (await call(alice, "haul", act="join"))["code"] == "already_in"
    fran = await connect_and_auth(client, "fran", G)
    await call(fran, "load")
    assert (await call(fran, "haul", act="join"))["code"] == "haul_live"
    jx, jy = L.HAUL_JOIN["x"], L.HAUL_JOIN["y"]
    dx, dy = L.HAUL_DROP["x"], L.HAUL_DROP["y"]
    assert (await call(alice, "haul", act="drop", x=dx, y=dy))["code"] == "empty_hands"
    assert (await call(alice, "haul", act="take", x=jx, y=jy))["ok"]
    assert (await call(bob, "haul", act="take", x=jx, y=jy))["ok"]
    assert (await call(bob, "haul", act="drop", x=dx, y=dy))["ok"]
    assert (await call(alice, "haul", act="take", x=jx, y=jy))["ok"]
    assert (await call(alice, "haul", act="drop", x=dx, y=dy))["ok"]
    assert (await call(alice, "haul", act="take", x=jx, y=jy))["ok"]
    assert (await call(alice, "haul", act="drop", x=dx, y=dy))["ok"]
    _clock.value = plaza.haul["startedAt"] / 1000 + L.HAUL_ROUND_MS / 1000 + 0.05
    view = await call(alice, "haul", act="view")
    assert view["haul"]["status"] == "over"
    assert plaza.players["alice"]["gold"] == g0 + 40
    assert plaza.players["bob"]["gold"] == g0 + 20
    assert plaza.players["carol"]["gold"] == g0 + 10
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await fran.close()


def test_light_rules_match_frontend() -> None:
    script = r"""
    const G = await import('./site/games/community/pie-plaza/src/game/light.js');
    let rnd = G.newLight();
    for (const [id, name] of [['a','A'],['b','B'],['c','C']]) rnd = G.lightJoin(rnd, id, name, 0).round;
    const S = G.LIGHT.spots;
    const early = G.lightDash(rnd, 'a', S[0].id, S[0].x, S[0].y, 1);
    G.maybeExpireLight(rnd, (rnd.startedAt || 0) + G.LIGHT.countdownMs);
    const fourth = G.lightJoin(rnd, 'e', 'E', (rnd.startedAt || 0) + 1);
    const already = G.lightJoin(rnd, 'a', 'A', (rnd.startedAt || 0) + 2);
    const wrong = G.lightDash(rnd, 'a', S[1].id, S[1].x, S[1].y, G.LIGHT.countdownMs + 10);
    const far = G.lightDash(rnd, 'a', S[0].id, 0, 0, G.LIGHT.countdownMs + 11);
    G.lightDash(rnd, 'a', S[0].id, S[0].x, S[0].y, G.LIGHT.countdownMs + 12);
    const redAt = G.LIGHT.countdownMs + G.LIGHT.greenMs + 10;
    const red = G.lightDash(rnd, 'b', S[0].id, S[0].x, S[0].y, redAt);
    G.maybeExpireLight(rnd, rnd.startedAt + G.LIGHT.roundMs);
    const rec = { gold: 100 };
    const pay = G.applyLightGold(rec, 'a', rnd);
    const over = G.lightDash(rnd, 'a', S[0].id, S[0].x, S[0].y, 99);
    console.log(JSON.stringify({ third: 'countdown', early: early.code, fourth: fourth.code, already: already.code, wrong: wrong.code, far: far.code, redOut: !!red.out, payouts: rnd.payouts, pay, gold: rec.gold, over: over.code, scores: { a: rnd.players.a.score, b: rnd.players.b.score, c: rnd.players.c.score } }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    rnd = L.new_light()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C")):
        rnd = L.light_join(rnd, uid, name, 0)["round"]
    assert rnd["status"] == js["third"] == "countdown"
    s0, s1 = L.LIGHT_SPOTS[0], L.LIGHT_SPOTS[1]
    early = L.light_dash(rnd, "a", s0["id"], s0["x"], s0["y"], 1)
    L.maybe_expire_light(rnd, (rnd.get("startedAt") or 0) + L.LIGHT_COUNTDOWN_MS)
    fourth = L.light_join(rnd, "e", "E", (rnd.get("startedAt") or 0) + 1)
    already = L.light_join(rnd, "a", "A", (rnd.get("startedAt") or 0) + 2)
    wrong = L.light_dash(rnd, "a", s1["id"], s1["x"], s1["y"], L.LIGHT_COUNTDOWN_MS + 10)
    far = L.light_dash(rnd, "a", s0["id"], 0, 0, L.LIGHT_COUNTDOWN_MS + 11)
    L.light_dash(rnd, "a", s0["id"], s0["x"], s0["y"], L.LIGHT_COUNTDOWN_MS + 12)
    red_at = L.LIGHT_COUNTDOWN_MS + L.LIGHT_GREEN_MS + 10
    red = L.light_dash(rnd, "b", s0["id"], s0["x"], s0["y"], red_at)
    L.maybe_expire_light(rnd, rnd["startedAt"] + L.LIGHT_ROUND_MS)
    rec = {"gold": 100}
    pay = L.apply_light_gold(rec, "a", rnd)
    over = L.light_dash(rnd, "a", s0["id"], s0["x"], s0["y"], 99)
    assert early["code"] == js["early"] == "not_live"
    assert fourth["code"] == js["fourth"] == "light_live"
    assert already["code"] == js["already"] == "already_in"
    assert wrong["code"] == js["wrong"] == "wrong_spot"
    assert far["code"] == js["far"] == "too_far"
    assert red.get("out") is True and js["redOut"] is True
    assert rnd["payouts"] == js["payouts"]
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert over["code"] == js["over"] == "light_over"
    assert {uid: rnd["players"][uid]["score"] for uid in ("a", "b", "c")} == js["scores"]


@pytest.mark.asyncio
async def test_light_ops_dash_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "light", act="join"))["ok"]
    assert (await call(bob, "light", act="join"))["ok"]
    j3 = await call(carol, "light", act="join")
    assert j3["light"]["status"] == "countdown"
    _clock.value = plaza.light["startedAt"] / 1000 + L.LIGHT_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "light", act="view")
    assert live["light"]["status"] == "live"
    assert live["light"]["light"] == "green"
    assert (await call(alice, "light", act="join"))["code"] == "already_in"
    fran = await connect_and_auth(client, "fran", G)
    await call(fran, "load")
    assert (await call(fran, "light", act="join"))["code"] == "light_live"
    s0, s1 = L.LIGHT_SPOTS[0], L.LIGHT_SPOTS[1]
    assert (await call(alice, "light", act="dash", spot=s1["id"], x=s1["x"], y=s1["y"]))["code"] == "wrong_spot"
    assert (await call(alice, "light", act="dash", spot=s0["id"], x=0, y=0))["code"] == "too_far"
    stepped = await call(alice, "light", act="dash", spot=s0["id"], x=s0["x"], y=s0["y"])
    assert stepped["ok"]
    assert stepped["light"]["yourScore"] == 1
    _clock.value = plaza.light["startedAt"] / 1000 + L.LIGHT_GREEN_MS / 1000 + 0.05
    red = await call(bob, "light", act="dash", spot=s0["id"], x=s0["x"], y=s0["y"])
    assert red["ok"]
    bob_row = next(p for p in red["light"]["players"] if p["id"] == "bob")
    assert bob_row["out"] is True
    _clock.value = plaza.light["startedAt"] / 1000 + L.LIGHT_ROUND_MS / 1000 + 0.05
    view = await call(alice, "light", act="view")
    assert view["light"]["status"] == "over"
    assert plaza.players["alice"]["gold"] == g0 + 40
    assert plaza.players["carol"]["gold"] == g0 + 20
    assert plaza.players["bob"]["gold"] == g0 + 10
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await fran.close()


def test_hill_rules_match_frontend() -> None:
    script = r"""
    const H = await import('./site/games/community/pie-plaza/src/game/hill.js');
    let rnd = H.newHill();
    for (const [id, name] of [['a','A'],['b','B'],['c','C']]) rnd = H.hillJoin(rnd, id, name, 0).round;
    const early = H.hillTake(rnd, 'a', H.HILL_JOIN.x, H.HILL_JOIN.y, 1);
    H.maybeExpireHill(rnd, (rnd.startedAt || 0) + H.HILL.countdownMs);
    const fourth = H.hillJoin(rnd, 'e', 'E', (rnd.startedAt || 0) + 1);
    const already = H.hillJoin(rnd, 'a', 'A', (rnd.startedAt || 0) + 2);
    const liveAt = rnd.startedAt;
    H.hillTake(rnd, 'a', H.HILL_JOIN.x, H.HILL_JOIN.y, liveAt + 12);
    H.hillTake(rnd, 'b', H.HILL_JOIN.x, H.HILL_JOIN.y, liveAt + 112);
    H.hillTake(rnd, 'a', H.HILL_JOIN.x, H.HILL_JOIN.y, liveAt + 200);
    H.maybeExpireHill(rnd, liveAt + H.HILL.roundMs);
    const rec = { gold: 100 };
    const pay = H.applyHillGold(rec, 'a', rnd);
    const over = H.hillTake(rnd, 'a', H.HILL_JOIN.x, H.HILL_JOIN.y, 99);
    console.log(JSON.stringify({ third: 'countdown', early: early.code, fourth: fourth.code, already: already.code, payouts: rnd.payouts, pay, gold: rec.gold, over: over.code }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    rnd = L.new_hill()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C")):
        rnd = L.hill_join(rnd, uid, name, 0)["round"]
    assert rnd["status"] == js["third"] == "countdown"
    early = L.hill_take(rnd, "a", L.HILL_JOIN["x"], L.HILL_JOIN["y"], 1)
    L.maybe_expire_hill(rnd, (rnd.get("startedAt") or 0) + L.HILL_COUNTDOWN_MS)
    fourth = L.hill_join(rnd, "e", "E", (rnd.get("startedAt") or 0) + 1)
    already = L.hill_join(rnd, "a", "A", (rnd.get("startedAt") or 0) + 2)
    live_at = rnd["startedAt"]
    L.hill_take(rnd, "a", L.HILL_JOIN["x"], L.HILL_JOIN["y"], live_at + 12)
    L.hill_take(rnd, "b", L.HILL_JOIN["x"], L.HILL_JOIN["y"], live_at + 112)
    L.hill_take(rnd, "a", L.HILL_JOIN["x"], L.HILL_JOIN["y"], live_at + 200)
    L.maybe_expire_hill(rnd, live_at + L.HILL_ROUND_MS)
    rec = {"gold": 100}
    pay = L.apply_hill_gold(rec, "a", rnd)
    over = L.hill_take(rnd, "a", L.HILL_JOIN["x"], L.HILL_JOIN["y"], 99)
    assert early["code"] == js["early"] == "not_live"
    assert fourth["code"] == js["fourth"] == "hill_live"
    assert already["code"] == js["already"] == "already_in"
    assert rnd["payouts"] == js["payouts"]
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert over["code"] == js["over"] == "hill_over"


@pytest.mark.asyncio
async def test_hill_ops_take_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "hill", act="join"))["ok"]
    assert (await call(bob, "hill", act="join"))["ok"]
    j3 = await call(carol, "hill", act="join")
    assert j3["hill"]["status"] == "countdown"
    _clock.value = plaza.hill["startedAt"] / 1000 + L.HILL_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "hill", act="view")
    assert live["hill"]["status"] == "live"
    assert (await call(alice, "hill", act="join"))["code"] == "already_in"
    hugo = await connect_and_auth(client, "hugo", G)
    await call(hugo, "load")
    assert (await call(hugo, "hill", act="join"))["code"] == "hill_live"
    jx, jy = L.HILL_JOIN["x"], L.HILL_JOIN["y"]
    assert (await call(alice, "hill", act="take", x=jx, y=jy))["ok"]
    assert (await call(alice, "hill", act="take", x=jx, y=jy))["code"] == "already_holding"
    _clock.value = plaza.hill["startedAt"] / 1000 + 30
    assert (await call(bob, "hill", act="take", x=jx, y=jy))["ok"]
    _clock.value = plaza.hill["startedAt"] / 1000 + 32
    assert (await call(alice, "hill", act="take", x=jx, y=jy))["ok"]
    _clock.value = plaza.hill["startedAt"] / 1000 + L.HILL_ROUND_MS / 1000 + 0.05
    view = await call(alice, "hill", act="view")
    assert view["hill"]["status"] == "over"
    assert plaza.players["alice"]["gold"] == g0 + 40
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await hugo.close()


def test_smash_rules_match_frontend() -> None:
    script = r"""
    const S = await import('./site/games/community/pie-plaza/src/game/smash.js');
    let rnd = S.newSmash();
    for (const [id, name] of [['a','A'],['b','B'],['c','C']]) rnd = S.smashJoin(rnd, id, name, 0).round;
    const early = S.smashHit(rnd, 'a', S.SMASH_JOIN.x, S.SMASH_JOIN.y, 1);
    S.maybeExpireSmash(rnd, (rnd.startedAt || 0) + S.SMASH.countdownMs);
    const fourth = S.smashJoin(rnd, 'e', 'E', (rnd.startedAt || 0) + 1);
    const already = S.smashJoin(rnd, 'a', 'A', (rnd.startedAt || 0) + 2);
    const liveAt = rnd.startedAt;
    S.smashHit(rnd, 'a', S.SMASH_JOIN.x, S.SMASH_JOIN.y, liveAt + 12);
    S.smashHit(rnd, 'b', S.SMASH_JOIN.x, S.SMASH_JOIN.y, liveAt + 14);
    const downAt = liveAt + S.SMASH.upMs + 10;
    const miss = S.smashHit(rnd, 'a', S.SMASH_JOIN.x, S.SMASH_JOIN.y, downAt);
    const pop1 = liveAt + S.SMASH.upMs + S.SMASH.downMs + 10;
    S.smashHit(rnd, 'a', S.SMASH_JOIN.x, S.SMASH_JOIN.y, pop1);
    S.maybeExpireSmash(rnd, liveAt + S.SMASH.roundMs);
    const rec = { gold: 100 };
    const pay = S.applySmashGold(rec, 'a', rnd);
    const over = S.smashHit(rnd, 'a', S.SMASH_JOIN.x, S.SMASH_JOIN.y, 99);
    console.log(JSON.stringify({ third: 'countdown', early: early.code, fourth: fourth.code, already: already.code, miss: miss.code, payouts: rnd.payouts, pay, gold: rec.gold, over: over.code }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    rnd = L.new_smash()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C")):
        rnd = L.smash_join(rnd, uid, name, 0)["round"]
    assert rnd["status"] == js["third"] == "countdown"
    early = L.smash_hit(rnd, "a", L.SMASH_JOIN["x"], L.SMASH_JOIN["y"], 1)
    L.maybe_expire_smash(rnd, (rnd.get("startedAt") or 0) + L.SMASH_COUNTDOWN_MS)
    fourth = L.smash_join(rnd, "e", "E", (rnd.get("startedAt") or 0) + 1)
    already = L.smash_join(rnd, "a", "A", (rnd.get("startedAt") or 0) + 2)
    live_at = rnd["startedAt"]
    L.smash_hit(rnd, "a", L.SMASH_JOIN["x"], L.SMASH_JOIN["y"], live_at + 12)
    L.smash_hit(rnd, "b", L.SMASH_JOIN["x"], L.SMASH_JOIN["y"], live_at + 14)
    down_at = live_at + L.SMASH_UP_MS + 10
    miss = L.smash_hit(rnd, "a", L.SMASH_JOIN["x"], L.SMASH_JOIN["y"], down_at)
    pop1 = live_at + L.SMASH_UP_MS + L.SMASH_DOWN_MS + 10
    L.smash_hit(rnd, "a", L.SMASH_JOIN["x"], L.SMASH_JOIN["y"], pop1)
    L.maybe_expire_smash(rnd, live_at + L.SMASH_ROUND_MS)
    rec = {"gold": 100}
    pay = L.apply_smash_gold(rec, "a", rnd)
    over = L.smash_hit(rnd, "a", L.SMASH_JOIN["x"], L.SMASH_JOIN["y"], 99)
    assert early["code"] == js["early"] == "not_live"
    assert fourth["code"] == js["fourth"] == "smash_live"
    assert already["code"] == js["already"] == "already_in"
    assert miss["code"] == js["miss"] == "not_up"
    assert rnd["payouts"] == js["payouts"]
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert over["code"] == js["over"] == "smash_over"


@pytest.mark.asyncio
async def test_smash_ops_hit_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "smash", act="join"))["ok"]
    assert (await call(bob, "smash", act="join"))["ok"]
    j3 = await call(carol, "smash", act="join")
    assert j3["smash"]["status"] == "countdown"
    _clock.value = plaza.smash["startedAt"] / 1000 + L.SMASH_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "smash", act="view")
    assert live["smash"]["status"] == "live"
    assert (await call(alice, "smash", act="join"))["code"] == "already_in"
    iris = await connect_and_auth(client, "iris", G)
    await call(iris, "load")
    assert (await call(iris, "smash", act="join"))["code"] == "smash_live"
    jx, jy = L.SMASH_JOIN["x"], L.SMASH_JOIN["y"]
    assert (await call(alice, "smash", act="hit", x=jx, y=jy))["ok"]
    assert (await call(alice, "smash", act="hit", x=jx, y=jy))["code"] == "already_hit"
    assert (await call(bob, "smash", act="hit", x=jx, y=jy))["ok"]
    _clock.value = plaza.smash["startedAt"] / 1000 + (L.SMASH_UP_MS + L.SMASH_DOWN_MS) / 1000 + 0.05
    assert (await call(alice, "smash", act="hit", x=jx, y=jy))["ok"]
    _clock.value = plaza.smash["startedAt"] / 1000 + L.SMASH_ROUND_MS / 1000 + 0.05
    view = await call(alice, "smash", act="view")
    assert view["smash"]["status"] == "over"
    assert plaza.players["alice"]["gold"] == g0 + 40
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await iris.close()


def test_vase_rules_match_frontend() -> None:
    script = r"""
    const V = await import('./site/games/community/pie-plaza/src/game/vase.js');
    let rnd = V.newVase();
    for (const [id, name] of [['a','A'],['b','B'],['c','C']]) rnd = V.vaseJoin(rnd, id, name, 0).round;
    const early = V.vaseTake(rnd, 'a', V.VASE_JOIN.x, V.VASE_JOIN.y, 1);
    V.maybeExpireVase(rnd, (rnd.startedAt || 0) + V.VASE.countdownMs);
    const fourth = V.vaseJoin(rnd, 'e', 'E', (rnd.startedAt || 0) + 1);
    const already = V.vaseJoin(rnd, 'a', 'A', (rnd.startedAt || 0) + 2);
    const liveAt = rnd.startedAt;
    V.vaseTake(rnd, 'a', V.VASE_JOIN.x, V.VASE_JOIN.y, liveAt + 12);
    const ours = V.vaseTake(rnd, 'c', V.VASE_JOIN.x, V.VASE_JOIN.y, liveAt + 14);
    V.vaseTake(rnd, 'b', V.VASE_JOIN.x, V.VASE_JOIN.y, liveAt + 112);
    V.vaseTake(rnd, 'a', V.VASE_JOIN.x, V.VASE_JOIN.y, liveAt + 200);
    V.maybeExpireVase(rnd, liveAt + V.VASE.roundMs);
    const rec = { gold: 100 };
    const pay = V.applyVaseGold(rec, 'a', rnd);
    const over = V.vaseTake(rnd, 'a', V.VASE_JOIN.x, V.VASE_JOIN.y, 99);
    console.log(JSON.stringify({ third: 'countdown', early: early.code, fourth: fourth.code, already: already.code, ours: ours.code, winner: rnd.winner, payouts: rnd.payouts, pay, gold: rec.gold, over: over.code }));
    """
    js = json.loads(subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout)
    rnd = L.new_vase()
    for uid, name in (("a", "A"), ("b", "B"), ("c", "C")):
        rnd = L.vase_join(rnd, uid, name, 0)["round"]
    assert rnd["status"] == js["third"] == "countdown"
    early = L.vase_take(rnd, "a", L.VASE_JOIN["x"], L.VASE_JOIN["y"], 1)
    L.maybe_expire_vase(rnd, (rnd.get("startedAt") or 0) + L.VASE_COUNTDOWN_MS)
    fourth = L.vase_join(rnd, "e", "E", (rnd.get("startedAt") or 0) + 1)
    already = L.vase_join(rnd, "a", "A", (rnd.get("startedAt") or 0) + 2)
    live_at = rnd["startedAt"]
    L.vase_take(rnd, "a", L.VASE_JOIN["x"], L.VASE_JOIN["y"], live_at + 12)
    ours = L.vase_take(rnd, "c", L.VASE_JOIN["x"], L.VASE_JOIN["y"], live_at + 14)
    L.vase_take(rnd, "b", L.VASE_JOIN["x"], L.VASE_JOIN["y"], live_at + 112)
    L.vase_take(rnd, "a", L.VASE_JOIN["x"], L.VASE_JOIN["y"], live_at + 200)
    L.maybe_expire_vase(rnd, live_at + L.VASE_ROUND_MS)
    rec = {"gold": 100}
    pay = L.apply_vase_gold(rec, "a", rnd)
    over = L.vase_take(rnd, "a", L.VASE_JOIN["x"], L.VASE_JOIN["y"], 99)
    assert early["code"] == js["early"] == "not_live"
    assert fourth["code"] == js["fourth"] == "vase_live"
    assert already["code"] == js["already"] == "already_in"
    assert ours["code"] == js["ours"] == "already_ours"
    assert rnd["winner"] == js["winner"] == "red"
    assert rnd["payouts"] == js["payouts"]
    assert pay == js["pay"] == 40 and rec["gold"] == js["gold"] == 140
    assert over["code"] == js["over"] == "vase_over"


@pytest.mark.asyncio
async def test_vase_ops_take_persist_and_reject(aiohttp_client, tmp_path) -> None:
    client, plaza, store, _clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    carol = await connect_and_auth(client, "carol", G)
    await call(alice, "load")
    await call(bob, "load")
    await call(carol, "load")
    g0 = plaza.players["alice"]["gold"]
    assert (await call(alice, "vase", act="join"))["ok"]
    assert (await call(bob, "vase", act="join"))["ok"]
    j3 = await call(carol, "vase", act="join")
    assert j3["vase"]["status"] == "countdown"
    _clock.value = plaza.vase["startedAt"] / 1000 + L.VASE_COUNTDOWN_MS / 1000 + 0.05
    live = await call(alice, "vase", act="view")
    assert live["vase"]["status"] == "live"
    assert (await call(alice, "vase", act="join"))["code"] == "already_in"
    jade = await connect_and_auth(client, "jade", G)
    await call(jade, "load")
    assert (await call(jade, "vase", act="join"))["code"] == "vase_live"
    jx, jy = L.VASE_JOIN["x"], L.VASE_JOIN["y"]
    assert (await call(alice, "vase", act="take", x=jx, y=jy))["ok"]
    assert (await call(alice, "vase", act="take", x=jx, y=jy))["code"] == "already_holding"
    assert (await call(carol, "vase", act="take", x=jx, y=jy))["code"] == "already_ours"
    _clock.value = plaza.vase["startedAt"] / 1000 + 30
    assert (await call(bob, "vase", act="take", x=jx, y=jy))["ok"]
    _clock.value = plaza.vase["startedAt"] / 1000 + 32
    assert (await call(alice, "vase", act="take", x=jx, y=jy))["ok"]
    _clock.value = plaza.vase["startedAt"] / 1000 + L.VASE_ROUND_MS / 1000 + 0.05
    view = await call(alice, "vase", act="view")
    assert view["vase"]["status"] == "over"
    assert plaza.players["alice"]["gold"] == g0 + 40
    await plaza.flush()
    again = PlazaService(store, clock=_clock, rng=random.Random(1))
    rec = await again.load("alice", "Alice")
    assert rec["gold"] == g0 + 40
    await alice.close()
    await bob.close()
    await carol.close()
    await jade.close()


# ---------- 派派大作戰 ----------
@pytest.mark.asyncio
async def test_arena_show_with_bots_pays_human(aiohttp_client, tmp_path, monkeypatch) -> None:
    from server.games import arena as AR
    monkeypatch.setattr("server.games.plaza.ARENA_SECONDS", 0.01)
    client, plaza, _, clock = await make(aiohttp_client, tmp_path)
    alice = await connect_and_auth(client, "alice", G)
    await alice.send_json({"type": "create", "maxPlayers": 16, "name": "廣場大廳"})
    await drain(alice)
    gold0 = (await call(alice, "load"))["me"]["gold"]
    # 太遠不能報名；走到報名台（位置訊息）後可以
    assert (await call(alice, "arena", act="join", x=10, y=10))["code"] == "too_far"
    await alice.send_json({"type": "send", "data": {"k": "p", "p": list(AR.DESK), "a": "arena"}})
    r = await call(alice, "arena", act="join", x=AR.DESK[0], y=AR.DESK[1])
    assert r["arena"]["ph"] == "queue" and r["arena"]["q"][0][0] == "alice"
    # 倒數結束：NPC 補到 4 人，三回合跑完
    seen = set()
    for _ in range(400):
        clock.advance(1.0)
        await asyncio.sleep(0.02)
        await alice.send_json({"type": "send", "data": {"k": "p", "p": [240, 160], "a": "arena"}})
        for m in await drain_quick(alice):
            if m.get("op") == "arena":
                seen.add(m["arena"]["ph"])
        if plaza.arena.phase == "idle" and "final" in seen:
            break
    assert {"intro", "live", "result", "final"} <= seen
    st = plaza.players["alice"]["arena"]
    assert st["shows"] == 1 and st["paid"] == 1
    assert plaza.players["alice"]["gold"] > gold0
    await alice.close()


async def drain_quick(ws):
    out = []
    while True:
        try:
            out.append(await ws.receive_json(timeout=0.01))
        except asyncio.TimeoutError:
            return out



# ---------- 集章手冊與每日委託 ----------
@pytest.mark.asyncio
async def test_quests_stamps_daily_and_titles(aiohttp_client, tmp_path) -> None:
    from server.games import quests as Q
    client, plaza, _, clock = await make(aiohttp_client, tmp_path, quests=True)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    await call(alice, "load")
    await call(bob, "load")
    v = (await call(alice, "quests"))["quests"]
    assert len(v["daily"]) == 3 and v["count"] == 0 and v["total"] == len(Q.STAMPS)
    assert len({Q.DAILY_POOL[i][0] for i in Q.daily_pick("alice", "2027-01-15")}) == 3
    gold0 = plaza.players["alice"]["gold"]
    # 許願：第一次許願不給章，但會累計
    await call(alice, "wish")
    assert plaza.players["alice"]["prog"]["wish"] == 1
    # 拜訪與稱讚 → 進度；bob 被稱讚 → liked_best
    await call(alice, "view", owner="bob")
    assert plaza.players["alice"]["uniq"]["visit"] == ["bob"]
    await call(alice, "like", owner="bob")
    assert plaza.players["bob"]["prog"]["liked_best"] == 1
    # 收成第一個作物 → 「第一次收成」章（推播 me 帶 quest）
    rec = plaza.players["alice"]
    rec["farm"]["tilled"]["22,12"] = {"w": 0}
    rec["farm"]["crops"]["22,12"] = {"t": "wheat", "s": 3, "w": 0, "at": 0}
    await drain(alice)
    await alice.send_json({"type": "game", "op": "tool", "rid": "h1", "tool": "sickle", "x": 22, "y": 12})
    msgs = []
    while not msgs or msgs[-1].get("rid") != "h1":
        msgs.append(await alice.receive_json(timeout=2))
    assert msgs[-1]["result"].get("harvest") == "wheat"
    got = [q for m in msgs if m.get("op") == "me" for q in (m.get("quest") or [])]
    assert any(q["t"] == "stamp" and q["id"] == "farm_first" for q in got)
    assert "farm_first" in plaza.players["alice"]["stamps"]
    # 同一個章不會再發
    before = plaza.players["alice"]["gold"]
    rec["farm"]["tilled"]["23,12"] = {"w": 0}
    rec["farm"]["crops"]["23,12"] = {"t": "wheat", "s": 3, "w": 0, "at": 0}
    await call(alice, "tool", tool="sickle", x=23, y=12)
    assert plaza.players["alice"]["gold"] == before or any(
        q["t"] == "daily" for m in await drain(alice) if m.get("op") == "me" for q in (m.get("quest") or []))
    v = (await call(alice, "quests"))["quests"]
    st = {x["id"]: x for x in v["stamps"]}
    assert st["farm_first"]["got"] and st["farm_50"]["have"] == 2 and st["social_visit10"]["have"] == 1
    assert plaza.players["alice"]["gold"] > gold0 - 10
    for ws in (alice, bob):
        await ws.close()


def test_quests_category_title_and_daily_bonus() -> None:
    from server.games import quests as Q
    rec = {"gold": 0}
    day = "2027-01-15"
    pick = Q.daily_pick("u9", day)
    ev = [(Q.DAILY_POOL[i][1], Q.DAILY_POOL[i][2]) for i in pick]
    done = Q.note(rec, "u9", ev, day, 1)
    assert sum(1 for d in done if d["t"] == "daily") == 3 and any(d["t"] == "bonus" for d in done)
    assert not [d for d in Q.note(rec, "u9", ev, day, 2) if d["t"] in ("daily", "bonus")]
    # 新的一天重新開始
    assert rec["daily"]["day"] == day
    Q.note(rec, "u9", [], "2027-01-16", 3)
    assert rec["daily"]["day"] == "2027-01-16" and rec["daily"]["done"] == []
    # 集滿一類 → 稱號＋獎金
    town = [s for s in Q.STAMPS if s[1] == "town"]
    out = Q.note(rec, "u9", [(s[4], s[5]) for s in town], "2027-01-16", 4)
    assert any(d["t"] == "title" and d["name"] == "派派通" for d in out) and "派派通" in rec["titles"]
    # 最高紀錄取最大值，不累加
    Q.note(rec, "u9", [("arena_coin_best", 12)], day, 5)
    Q.note(rec, "u9", [("arena_coin_best", 7)], day, 6)
    assert rec["prog"]["arena_coin_best"] == 12


# ---------- 九個廣場派對的鎮民補位 ----------
@pytest.mark.asyncio
async def test_party_bots_fill_and_play_all_nine(tmp_path) -> None:
    from server.games import party_bots as PB

    class FakeRelay:
        connections: list = []

    store = SaveStore(tmp_path / "s.sqlite3")
    clock = FakeClock()
    clock.value = 1_800_000_000.0
    plaza = PlazaService(store, clock=clock, rng=random.Random(3))
    relay = FakeRelay()
    now = plaza.now_ms()
    for kind in PB.KINDS:
        r = PB.JOIN[kind](getattr(plaza, kind), "alice", "Alice", now)
        assert r["ok"], kind
        setattr(plaza, kind, r["round"])
    await plaza._party_bots(relay)
    assert all(getattr(plaza, k)["status"] == "open" for k in PB.KINDS), "還沒等夠，不補位"
    clock.advance(PB.FILL_MS / 1000 + 0.1)
    await plaza._party_bots(relay)
    for kind in PB.KINDS:
        rnd = getattr(plaza, kind)
        assert rnd["status"] in ("countdown", "live"), kind
        assert [u for u in rnd["order"] if PB.is_bot(u)] == [b for b, _ in PB.BOTS], kind
    acted = {k: 0 for k in PB.KINDS}
    for _ in range(700):                                     # 70 秒，每 0.1 秒一步
        clock.advance(0.1)
        now = plaza.now_ms()
        for kind in PB.KINDS:
            getattr(L, f"maybe_expire_{kind}")(getattr(plaza, kind), now)
        hot = plaza.hot
        if hot["status"] == "live" and hot["holder"] == "alice" and now - hot["heldAt"] > 1500:
            L.hot_take(hot, "alice", L.HOT_JOIN["x"], L.HOT_JOIN["y"], now)    # 真人把南瓜傳出去
        before = {k: json.dumps(getattr(plaza, k), sort_keys=True, default=str) for k in PB.KINDS}
        await plaza._party_bots(relay)
        for k in PB.KINDS:
            if json.dumps(getattr(plaza, k), sort_keys=True, default=str) != before[k]:
                acted[k] += 1
    for kind in PB.KINDS:
        rnd = getattr(plaza, kind)
        assert rnd["status"] == "over", kind
        assert "alice" in (rnd.get("payouts") or {}), kind
        assert acted[kind] >= 1, f"鎮民在 {kind} 沒有任何動作"


# ---------- 全鎮工程 ----------
@pytest.mark.asyncio
async def test_town_project_donate_finish_effects(aiohttp_client, tmp_path) -> None:
    from server.games import town as TW
    client, plaza, store, _ = await make(aiohttp_client, tmp_path, quests=True)
    alice = await connect_and_auth(client, "alice", G)
    bob = await connect_and_auth(client, "bob", G)
    await call(alice, "load")
    await call(bob, "load")
    v = await call(alice, "town", act="view")
    assert v["view"]["cur"]["id"] == "greenhouse" and v["grow"] == 1.0
    assert (await call(alice, "town", act="donate", item="wood", n=5))["code"] == "no_item"
    a = plaza.players["alice"]
    a["inv"].update(wood=60, stone=40, fiber=40, wheat=30)
    a["gold"] = 5000
    for item, n in (("wood", 60), ("stone", 40), ("fiber", 40), ("wheat", 30)):
        r = await call(alice, "town", act="donate", item=item, n=n)
        assert r["ok"] and r["took"] == n
    plaza.players["bob"]["gold"] = 3000
    r = await call(bob, "town", act="donate", item="gold", n=1500)
    assert r["done"]["id"] == "greenhouse"
    assert TW.built(plaza.town, "greenhouse") and L.GROW_SPEED == 1.25
    assert "town_top" in plaza.players["alice"]["stamps"] and "town_builder" in plaza.players["bob"]["stamps"]   # alice 1510 點 > bob 1500 點
    mails = await asyncio.to_thread(store.mail_list_sync, G, "alice")
    assert any(m["kind"] == "sysbuild" for m in mails)
    # 碼頭還沒蓋好不能在碼頭釣魚
    assert (await call(alice, "cast", where="pier"))["code"] == "not_built"
    # 存檔後重開伺服器：工程狀態還在、效果也在
    await plaza.flush()
    L.GROW_SPEED = 1.0
    again = PlazaService(store, clock=plaza.clock, rng=random.Random(2))
    assert TW.built(again.town, "greenhouse") and again.town["cur"] == "pier" and L.GROW_SPEED == 1.25
    L.GROW_SPEED = 1.0
    for ws in (alice, bob):
        await ws.close()
