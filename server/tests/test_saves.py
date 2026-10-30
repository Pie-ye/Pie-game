from __future__ import annotations

import json

import pytest
from aiohttp import web

from server.relay import MAX_SAVE_WRITES_PER_MINUTE, Relay
from server.saves import MAX_INBOX, MAX_KEYS_PER_USER, MAX_VALUE_BYTES, SaveError, SaveStore
from server.tests.test_relay import ORIGIN, FakeClock, connect_and_auth, ticket_redeemer


# ---------- SaveStore ----------
def test_store_roundtrip_and_isolation(tmp_path) -> None:
    store = SaveStore(tmp_path / "s.sqlite3", clock=lambda: 100.0)
    assert store.get_sync("g", "u1", "farm") is None
    assert store.put_sync("g", "u1", "farm", {"gold": 5}) == {"rev": 1, "updatedAt": 100.0}
    assert store.put_sync("g", "u1", "farm", {"gold": 6}) == {"rev": 2, "updatedAt": 100.0}
    assert store.get_sync("g", "u1", "farm") == {"value": {"gold": 6}, "rev": 2, "updatedAt": 100.0, "public": False}
    assert store.get_sync("g", "u2", "farm") is None, "other users cannot see it"
    assert store.get_sync("other-game", "u1", "farm") is None, "other games cannot see it"
    store.close()


def test_store_persists_across_reopen(tmp_path) -> None:
    path = tmp_path / "s.sqlite3"
    store = SaveStore(path)
    store.put_sync("g", 7, "look", [1, 2, 3])
    store.close()
    again = SaveStore(path)
    assert again.get_sync("g", "7", "look")["value"] == [1, 2, 3], "numeric ids are stored as strings"
    again.close()


def test_store_conflict_and_limits(tmp_path) -> None:
    store = SaveStore(tmp_path / "s.sqlite3")
    store.put_sync("g", "u", "farm", {"a": 1})
    with pytest.raises(SaveError) as conflict:
        store.put_sync("g", "u", "farm", {"a": 2}, if_rev=0)
    assert conflict.value.code == "save_conflict"
    assert conflict.value.current["value"] == {"a": 1}
    assert store.put_sync("g", "u", "farm", {"a": 2}, if_rev=1)["rev"] == 2
    with pytest.raises(SaveError) as big:
        store.put_sync("g", "u", "farm", "x" * (MAX_VALUE_BYTES + 1))
    assert big.value.code == "save_too_large"
    for bad in ("", "Farm", "a/b", "x" * 33, None, 5):
        with pytest.raises(SaveError):
            store.put_sync("g", "u", bad, 1)
    for i in range(MAX_KEYS_PER_USER - 1):
        store.put_sync("g", "u", f"k{i}", i)
    with pytest.raises(SaveError) as many:
        store.put_sync("g", "u", "one-too-many", 1)
    assert many.value.code == "save_too_many_keys"
    assert store.put_sync("g", "u", "k0", "update is fine")["rev"] == 2
    with pytest.raises(ValueError):
        store.put_sync("g", "u", "farm", float("nan"))
    store.close()


# ---------- 透過 WebSocket ----------
async def make_client(aiohttp_client, saves, **options):
    relay = Relay(ORIGIN, redeem=ticket_redeemer(), saves=saves, **options)
    app = web.Application()

    async def lifecycle(_: web.Application):
        await relay.start()
        yield
        await relay.close()

    app.cleanup_ctx.append(lifecycle)
    app.router.add_get("/mp", relay.websocket_handler)
    return await aiohttp_client(app), relay


@pytest.mark.asyncio
async def test_save_over_websocket(aiohttp_client, tmp_path) -> None:
    client, _ = await make_client(aiohttp_client, SaveStore(tmp_path / "s.sqlite3"))
    ws = await connect_and_auth(client, "alice", "pie-plaza")
    await ws.send_json({"type": "save:get", "key": "farm", "rid": "r1"})
    assert await ws.receive_json(timeout=1) == {"type": "save", "rid": "r1", "key": "farm", "value": None, "rev": 0, "updatedAt": None}
    await ws.send_json({"type": "save:put", "key": "farm", "value": {"gold": 10}, "ifRev": 0, "rid": "r2"})
    saved = await ws.receive_json(timeout=1)
    assert saved["type"] == "saved" and saved["rid"] == "r2" and saved["rev"] == 1
    await ws.send_json({"type": "save:put", "key": "farm", "value": {"gold": 11}, "ifRev": 0, "rid": "r3"})
    conflict = await ws.receive_json(timeout=1)
    assert conflict == {"type": "error", "code": "save_conflict", "rid": "r3", "current": {"value": {"gold": 10}, "rev": 1, "updatedAt": conflict["current"]["updatedAt"]}}

    # 另一個人、另一款遊戲都讀不到 alice 的 pie-plaza 存檔
    bob = await connect_and_auth(client, "bob", "pie-plaza")
    await bob.send_json({"type": "save:get", "key": "farm"})
    assert (await bob.receive_json(timeout=1))["value"] is None
    other = await connect_and_auth(client, "alice", "other-game")
    await other.send_json({"type": "save:get", "key": "farm"})
    assert (await other.receive_json(timeout=1))["value"] is None
    # 同一人換一台裝置（新連線）讀得到
    second = await connect_and_auth(client, "alice", "pie-plaza")
    await second.send_json({"type": "save:get", "key": "farm", "rid": "x"})
    assert (await second.receive_json(timeout=1))["value"] == {"gold": 10}
    for w in (ws, bob, other, second):
        await w.close()


@pytest.mark.asyncio
async def test_large_messages_only_allowed_for_saves(aiohttp_client, tmp_path) -> None:
    client, _ = await make_client(aiohttp_client, SaveStore(tmp_path / "s.sqlite3"))
    ws = await connect_and_auth(client, "alice", "pie-plaza")
    big = "x" * 30_000
    await ws.send_str(json.dumps({"type": "save:put", "key": "farm", "value": big, "rid": "a"}, separators=(",", ":")))
    assert (await ws.receive_json(timeout=1))["type"] == "saved"
    await ws.send_str(json.dumps({"type": "send", "data": big}, separators=(",", ":")))
    assert await ws.receive_json(timeout=1) == {"type": "error", "code": "message_too_large"}
    # 型別藏在後面也不行：只看開頭
    await ws.send_str(json.dumps({"value": big, "type": "save:put", "key": "farm"}, separators=(",", ":")))
    assert await ws.receive_json(timeout=1) == {"type": "error", "code": "message_too_large"}
    await ws.close()


@pytest.mark.asyncio
async def test_save_write_rate_limit(aiohttp_client, tmp_path) -> None:
    clock = FakeClock()
    client, _ = await make_client(aiohttp_client, SaveStore(tmp_path / "s.sqlite3"), clock=clock, max_messages_per_second=1000)
    ws = await connect_and_auth(client, "alice", "pie-plaza")
    for i in range(MAX_SAVE_WRITES_PER_MINUTE):
        await ws.send_json({"type": "save:put", "key": "farm", "value": i})
        assert (await ws.receive_json(timeout=1))["type"] == "saved"
    await ws.send_json({"type": "save:put", "key": "farm", "value": "no", "rid": "z"})
    assert await ws.receive_json(timeout=1) == {"type": "error", "code": "save_rate_limited", "rid": "z"}
    clock.advance(61)
    await ws.send_json({"type": "save:put", "key": "farm", "value": "ok"})
    assert (await ws.receive_json(timeout=1))["type"] == "saved"
    await ws.close()


@pytest.mark.asyncio
async def test_bad_save_requests(aiohttp_client, tmp_path) -> None:
    client, _ = await make_client(aiohttp_client, SaveStore(tmp_path / "s.sqlite3"))
    ws = await connect_and_auth(client, "alice", "pie-plaza")
    cases = [
        ({"type": "save:get", "key": "../etc", "rid": "a"}, "bad_save_key"),
        ({"type": "save:put", "key": "farm", "rid": "b"}, "bad_message"),
        ({"type": "save:put", "key": "farm", "value": 1, "ifRev": -1, "rid": "c"}, "bad_message"),
        ({"type": "save:put", "key": "farm", "value": 1, "ifRev": True, "rid": "d"}, "bad_message"),
    ]
    for msg, code in cases:
        await ws.send_json(msg)
        assert await ws.receive_json(timeout=1) == {"type": "error", "code": code, "rid": msg["rid"]}
    await ws.send_json({"type": "save:get", "key": "farm", "rid": "<script>"})
    assert (await ws.receive_json(timeout=1))["rid"] is None, "odd request ids are dropped, not echoed"
    await ws.close()


@pytest.mark.asyncio
async def test_save_unavailable_without_store(aiohttp_client) -> None:
    client, _ = await make_client(aiohttp_client, None)
    ws = await connect_and_auth(client, "alice", "pie-plaza")
    await ws.send_json({"type": "save:get", "key": "farm", "rid": "q"})
    assert await ws.receive_json(timeout=1) == {"type": "error", "code": "save_unavailable", "rid": "q"}
    await ws.close()


# ---------- 公開與拜訪 ----------
def test_public_peek_and_list(tmp_path) -> None:
    store = SaveStore(tmp_path / "s.sqlite3", clock=lambda: 1.0)
    store.put_sync("g", "u1", "home", {"crops": 3}, public=True)
    store.put_sync("g", "u1", "farm", {"gold": 99})                       # 私人
    store.put_sync("g", "u2", "card", {"name": "B"}, public=True)
    store.put_sync("g", "u3", "card", {"name": "C"}, public=False)
    store.put_sync("g", "u4", "card", {"big": "x" * 5000}, public=True)    # 太大，不列入名冊
    store.put_sync("other", "u5", "card", {"name": "E"}, public=True)
    assert store.peek_sync("g", "u1", "home")["value"] == {"crops": 3}
    assert store.peek_sync("g", "u1", "farm") is None, "private keys stay private"
    assert store.peek_sync("other", "u1", "home") is None
    names = [i["value"].get("name") for i in store.list_public_sync("g", "card")]
    assert names == ["B"]
    # 改成不公開後就讀不到
    store.put_sync("g", "u1", "home", {"crops": 3}, public=False)
    assert store.peek_sync("g", "u1", "home") is None
    with pytest.raises(SaveError):
        store.peek_sync("g", "../x", "home")
    store.close()


def test_migrates_old_database(tmp_path) -> None:
    import sqlite3 as sq
    path = tmp_path / "old.sqlite3"
    con = sq.connect(path)
    con.execute("CREATE TABLE saves (game_id TEXT, user_id TEXT, key TEXT, value TEXT, rev INTEGER, updated_at REAL, PRIMARY KEY (game_id, user_id, key))")
    con.execute("INSERT INTO saves VALUES ('g','u','farm','{\"a\":1}',1,1.0)")
    con.commit(); con.close()
    store = SaveStore(path)
    assert store.get_sync("g", "u", "farm") == {"value": {"a": 1}, "rev": 1, "updatedAt": 1.0, "public": False}
    store.close()


def test_mailbox(tmp_path) -> None:
    store = SaveStore(tmp_path / "s.sqlite3")
    store.mail_send_sync("g", "u2", "小菲", "u1", "note", {"text": "你的農場好漂亮"})
    store.mail_send_sync("g", "u3", "阿明", "u1", "like", {})
    store.mail_send_sync("other", "u3", "阿明", "u1", "like", {})
    items = store.mail_list_sync("g", "u1")
    assert [(i["fromName"], i["kind"]) for i in items] == [("阿明", "like"), ("小菲", "note")]
    assert store.mail_list_sync("g", "u2") == []
    assert store.mail_delete_sync("g", "u2", [items[0]["id"]]) == 0, "cannot delete other people's mail"
    assert store.mail_delete_sync("g", "u1", [items[0]["id"], True, "x"]) == 1
    for bad in ({"to": "../x", "kind": "note"}, {"to": "u1", "kind": "NOTE!"}):
        with pytest.raises(SaveError):
            store.mail_send_sync("g", "u2", "n", bad["to"], bad["kind"], {})
    with pytest.raises(SaveError):
        store.mail_send_sync("g", "u2", "n", "u1", "note", {"t": "x" * 2000})
    for i in range(MAX_INBOX + 5):
        store.mail_send_sync("g", "u9", "n", "u7", "like", {"i": i})
    kept = store.mail_list_sync("g", "u7")
    assert len(kept) == MAX_INBOX and kept[0]["data"]["i"] == MAX_INBOX + 4
    store.close()


@pytest.mark.asyncio
async def test_visit_and_mail_over_websocket(aiohttp_client, tmp_path) -> None:
    client, _ = await make_client(aiohttp_client, SaveStore(tmp_path / "s.sqlite3"))
    alice = await connect_and_auth(client, "alice", "pie-plaza")
    bob = await connect_and_auth(client, "bob", "pie-plaza")
    await alice.send_json({"type": "save:put", "key": "home", "value": {"style": "wood"}, "public": True, "rid": "a"})
    assert (await alice.receive_json(timeout=1))["type"] == "saved"
    await alice.send_json({"type": "save:put", "key": "card", "value": {"name": "Alice"}, "public": True, "rid": "b"})
    await alice.receive_json(timeout=1)
    await bob.send_json({"type": "save:peek", "user": "alice", "key": "home", "rid": "c"})
    peek = await bob.receive_json(timeout=1)
    assert peek["type"] == "save" and peek["value"] == {"style": "wood"} and peek["user"] == "alice"
    await bob.send_json({"type": "save:peek", "user": "alice", "key": "farm", "rid": "d"})
    assert (await bob.receive_json(timeout=1))["value"] is None
    await bob.send_json({"type": "save:list", "key": "card", "rid": "e"})
    listing = await bob.receive_json(timeout=1)
    assert listing["type"] == "saveList" and listing["items"][0]["user"] == "alice"
    # bob 寄信給 alice：寄件人由伺服器填，alice 線上會收到通知
    await bob.send_json({"type": "mail:send", "to": "alice", "kind": "note", "data": {"text": "hi", "fromName": "偽造"}, "rid": "f"})
    assert (await bob.receive_json(timeout=1))["type"] == "mailSent"
    assert await alice.receive_json(timeout=1) == {"type": "mail", "from": "bob", "kind": "note"}
    await alice.send_json({"type": "mail:list", "rid": "g"})
    inbox = await alice.receive_json(timeout=1)
    assert inbox["items"][0]["from"] == "bob" and inbox["items"][0]["fromName"] == "Bob"
    await alice.send_json({"type": "mail:delete", "ids": [inbox["items"][0]["id"]], "rid": "h"})
    assert (await alice.receive_json(timeout=1))["count"] == 1
    for _ in range(9):   # 前面已寄過一封，總共 10 封是上限
        await bob.send_json({"type": "mail:send", "to": "alice", "kind": "like", "data": {}})
        await bob.receive_json(timeout=1)
        await alice.receive_json(timeout=1)
    await bob.send_json({"type": "mail:send", "to": "alice", "kind": "like", "data": {}, "rid": "z"})
    assert await bob.receive_json(timeout=1) == {"type": "error", "code": "mail_rate_limited", "rid": "z"}
    await bob.send_json({"type": "save:put", "key": "x", "value": 1, "public": "yes", "rid": "p"})
    assert (await bob.receive_json(timeout=1))["code"] == "bad_message"
    await alice.close(); await bob.close()
