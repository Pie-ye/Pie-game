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
async def make(aiohttp_client, tmp_path, clock=None):
    store = SaveStore(tmp_path / "s.sqlite3")
    fake = clock or FakeClock()
    if clock is None:
        fake.value = 1_800_000_000.0
    plaza = PlazaService(store, clock=fake, rng=random.Random(1))
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
