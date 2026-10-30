from __future__ import annotations

import json

import pytest
from aiohttp import web

from server.relay import MAX_SAVE_WRITES_PER_MINUTE, Relay
from server.saves import MAX_KEYS_PER_USER, MAX_VALUE_BYTES, SaveError, SaveStore
from server.tests.test_relay import ORIGIN, FakeClock, connect_and_auth, ticket_redeemer


# ---------- SaveStore ----------
def test_store_roundtrip_and_isolation(tmp_path) -> None:
    store = SaveStore(tmp_path / "s.sqlite3", clock=lambda: 100.0)
    assert store.get_sync("g", "u1", "farm") is None
    assert store.put_sync("g", "u1", "farm", {"gold": 5}) == {"rev": 1, "updatedAt": 100.0}
    assert store.put_sync("g", "u1", "farm", {"gold": 6}) == {"rev": 2, "updatedAt": 100.0}
    assert store.get_sync("g", "u1", "farm") == {"value": {"gold": 6}, "rev": 2, "updatedAt": 100.0}
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
