from __future__ import annotations

import asyncio
import json
import re
from typing import Any

import pytest
from aiohttp import WSMsgType, WSServerHandshakeError, web

from server.relay import MAX_MESSAGE_BYTES, Relay

ORIGIN = "https://play.piea.uk"


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def ticket_redeemer(*, rejected: set[str] | None = None):
    rejected = rejected or set()

    async def redeem(ticket: str) -> dict[str, Any]:
        if ticket in rejected:
            raise ValueError("invalid ticket")
        user_id, game_id = ticket.split(":", 1)
        return {
            "userId": user_id,
            "username": user_id,
            "displayName": user_id.title(),
            "gameId": game_id,
        }

    return redeem


async def make_relay_client(aiohttp_client, **relay_options):
    relay = Relay(ORIGIN, redeem=ticket_redeemer(), **relay_options)
    app = web.Application()

    async def lifecycle(_: web.Application):
        await relay.start()
        yield
        await relay.close()

    app.cleanup_ctx.append(lifecycle)
    app.router.add_get("/mp", relay.websocket_handler)
    return await aiohttp_client(app), relay


async def connect_and_auth(client, user_id: str, game_id: str = "game-a"):
    ws = await client.ws_connect("/mp", headers={"Origin": ORIGIN})
    await ws.send_json({"type": "auth", "ticket": f"{user_id}:{game_id}", "gameId": game_id})
    welcome = await ws.receive_json(timeout=1)
    assert welcome == {
        "type": "welcome",
        "you": {"id": user_id, "username": user_id, "displayName": user_id.title()},
    }
    return ws


@pytest.mark.asyncio
async def test_origin_is_required(aiohttp_client) -> None:
    client, _ = await make_relay_client(aiohttp_client)

    with pytest.raises(WSServerHandshakeError) as missing:
        await client.ws_connect("/mp")
    assert missing.value.status == 403

    with pytest.raises(WSServerHandshakeError) as wrong:
        await client.ws_connect("/mp", headers={"Origin": "https://evil.example"})
    assert wrong.value.status == 403


@pytest.mark.asyncio
async def test_auth_success_timeout_bad_ticket_and_game_mismatch(aiohttp_client) -> None:
    relay = Relay(ORIGIN, redeem=ticket_redeemer(rejected={"bad"}), auth_timeout=0.02)
    app = web.Application()
    app.router.add_get("/mp", relay.websocket_handler)
    client = await aiohttp_client(app)

    good = await client.ws_connect("/mp", headers={"Origin": ORIGIN})
    await good.send_json({"type": "auth", "ticket": "alice:game-a", "gameId": "game-a"})
    assert (await good.receive_json(timeout=1))["type"] == "welcome"

    timed_out = await client.ws_connect("/mp", headers={"Origin": ORIGIN})
    assert await timed_out.receive_json(timeout=1) == {"type": "error", "code": "auth_timeout"}

    invalid = await client.ws_connect("/mp", headers={"Origin": ORIGIN})
    await invalid.send_json({"type": "auth", "ticket": "bad", "gameId": "game-a"})
    assert await invalid.receive_json(timeout=1) == {"type": "error", "code": "auth_failed"}

    mismatch = await client.ws_connect("/mp", headers={"Origin": ORIGIN})
    await mismatch.send_json({"type": "auth", "ticket": "bob:game-b", "gameId": "game-a"})
    assert await mismatch.receive_json(timeout=1) == {"type": "error", "code": "game_mismatch"}


@pytest.mark.asyncio
async def test_create_list_join_and_private_code(aiohttp_client) -> None:
    client, _ = await make_relay_client(aiohttp_client)
    host = await connect_and_auth(client, "host")
    guest = await connect_and_auth(client, "guest")

    await host.send_json({"type": "create", "maxPlayers": 4, "private": True, "name": "Friends"})
    joined = await host.receive_json(timeout=1)
    assert joined["type"] == "joined"
    assert joined["hostId"] == "host"
    assert joined["room"]["private"] is True
    code = joined["room"]["code"]
    assert re.fullmatch(r"[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}", code)

    await guest.send_json({"type": "list"})
    assert await guest.receive_json(timeout=1) == {"type": "rooms", "rooms": []}

    await guest.send_json({"type": "join", "roomId": joined["room"]["id"]})
    assert await guest.receive_json(timeout=1) == {"type": "error", "code": "room_not_found"}

    await guest.send_json({"type": "join", "code": code.lower()})
    guest_joined = await guest.receive_json(timeout=1)
    assert guest_joined["type"] == "joined"
    assert [player["id"] for player in guest_joined["players"]] == ["host", "guest"]
    assert (await host.receive_json(timeout=1))["type"] == "playerJoined"


@pytest.mark.asyncio
async def test_host_state_send_target_kick_and_handoff(aiohttp_client) -> None:
    client, _ = await make_relay_client(aiohttp_client)
    host = await connect_and_auth(client, "host")
    guest = await connect_and_auth(client, "guest")
    await host.send_json({"type": "create", "maxPlayers": 3, "private": False})
    room_id = (await host.receive_json(timeout=1))["room"]["id"]
    await guest.send_json({"type": "join", "roomId": room_id})
    await guest.receive_json(timeout=1)
    await host.receive_json(timeout=1)

    await guest.send_json({"type": "setState", "key": "turn", "value": "x"})
    assert await guest.receive_json(timeout=1) == {"type": "error", "code": "not_host"}

    await host.send_json({"type": "setState", "key": "turn", "value": "o"})
    expected_state = {"type": "state", "key": "turn", "value": "o"}
    assert await host.receive_json(timeout=1) == expected_state
    assert await guest.receive_json(timeout=1) == expected_state

    await guest.send_json({"type": "send", "data": {"move": 4}})
    expected_message = {"type": "message", "from": "guest", "data": {"move": 4}}
    assert await host.receive_json(timeout=1) == expected_message
    assert await guest.receive_json(timeout=1) == expected_message

    await host.send_json({"type": "send", "to": "guest", "data": "private"})
    assert await guest.receive_json(timeout=1) == {
        "type": "message",
        "from": "host",
        "data": "private",
    }

    await guest.send_json({"type": "kick", "playerId": "host"})
    assert await guest.receive_json(timeout=1) == {"type": "error", "code": "not_host"}

    await host.send_json({"type": "kick", "playerId": "guest"})
    assert await guest.receive_json(timeout=1) == {"type": "error", "code": "kicked"}
    assert await host.receive_json(timeout=1) == {"type": "playerLeft", "playerId": "guest"}
    await guest.send_json({"type": "send", "data": "after kick"})
    assert await guest.receive_json(timeout=1) == {"type": "error", "code": "not_in_room"}

    replacement = await connect_and_auth(client, "replacement")
    await replacement.send_json({"type": "join", "roomId": room_id})
    await replacement.receive_json(timeout=1)
    await host.receive_json(timeout=1)
    await host.close()
    assert await replacement.receive_json(timeout=1) == {"type": "playerLeft", "playerId": "host"}
    assert await replacement.receive_json(timeout=1) == {"type": "hostChanged", "hostId": "replacement"}


@pytest.mark.asyncio
async def test_empty_room_is_removed_after_sixty_seconds(aiohttp_client) -> None:
    clock = FakeClock()
    client, relay = await make_relay_client(aiohttp_client, clock=clock)
    host = await connect_and_auth(client, "host")
    await host.send_json({"type": "create", "private": False})
    room_id = (await host.receive_json(timeout=1))["room"]["id"]
    await host.send_json({"type": "leave"})
    for _ in range(10):
        if not relay.rooms[room_id].players:
            break
        await asyncio.sleep(0)

    clock.advance(59)
    await relay.cleanup_empty_rooms()
    assert room_id in relay.rooms
    clock.advance(1)
    await relay.cleanup_empty_rooms()
    assert room_id not in relay.rooms


@pytest.mark.asyncio
async def test_game_isolation_for_lists_and_joins(aiohttp_client) -> None:
    client, _ = await make_relay_client(aiohttp_client)
    game_a = await connect_and_auth(client, "alice", "game-a")
    game_b = await connect_and_auth(client, "bob", "game-b")
    await game_a.send_json({"type": "create", "private": False})
    room_id = (await game_a.receive_json(timeout=1))["room"]["id"]

    await game_b.send_json({"type": "list"})
    assert await game_b.receive_json(timeout=1) == {"type": "rooms", "rooms": []}
    await game_b.send_json({"type": "join", "roomId": room_id})
    assert await game_b.receive_json(timeout=1) == {"type": "error", "code": "room_not_found"}


@pytest.mark.asyncio
async def test_message_size_and_rate_limits(aiohttp_client) -> None:
    client, _ = await make_relay_client(
        aiohttp_client,
        max_message_bytes=256,
        max_messages_per_second=2,
    )
    ws = await connect_and_auth(client, "alice")

    await ws.send_str(json.dumps({"type": "send", "data": "x" * 300}))
    assert await ws.receive_json(timeout=1) == {"type": "error", "code": "message_too_large"}

    await ws.send_json({"type": "list"})
    await ws.send_json({"type": "list"})
    await ws.send_json({"type": "list"})
    assert (await ws.receive_json(timeout=1))["type"] == "rooms"
    assert (await ws.receive_json(timeout=1))["type"] == "rooms"
    assert await ws.receive_json(timeout=1) == {"type": "error", "code": "rate_limited"}
    assert MAX_MESSAGE_BYTES == 16 * 1024


@pytest.mark.asyncio
async def test_room_player_user_and_global_connection_limits(aiohttp_client) -> None:
    room_client, _ = await make_relay_client(aiohttp_client, max_rooms_per_game=1)
    first = await connect_and_auth(room_client, "first")
    second = await connect_and_auth(room_client, "second")
    await first.send_json({"type": "create", "maxPlayers": 1, "private": False})
    room_id = (await first.receive_json(timeout=1))["room"]["id"]
    await second.send_json({"type": "join", "roomId": room_id})
    assert await second.receive_json(timeout=1) == {"type": "error", "code": "room_full"}
    await second.send_json({"type": "create", "private": False})
    assert await second.receive_json(timeout=1) == {"type": "error", "code": "room_limit"}

    user_client, _ = await make_relay_client(aiohttp_client, max_connections_per_user=1)
    await connect_and_auth(user_client, "same-user")
    duplicate = await user_client.ws_connect("/mp", headers={"Origin": ORIGIN})
    await duplicate.send_json(
        {"type": "auth", "ticket": "same-user:game-a", "gameId": "game-a"}
    )
    assert await duplicate.receive_json(timeout=1) == {
        "type": "error",
        "code": "too_many_connections",
    }

    global_client, _ = await make_relay_client(aiohttp_client, max_connections=1)
    await connect_and_auth(global_client, "only")
    with pytest.raises(WSServerHandshakeError) as full:
        await global_client.ws_connect("/mp", headers={"Origin": ORIGIN})
    assert full.value.status == 503


@pytest.mark.asyncio
async def test_ping_pong_and_idle_disconnect(aiohttp_client) -> None:
    clock = FakeClock()
    client, relay = await make_relay_client(
        aiohttp_client,
        clock=clock,
        ping_interval=0.01,
        idle_timeout=75,
    )
    ws = await connect_and_auth(client, "alice")
    assert await ws.receive_json(timeout=1) == {"type": "ping"}
    clock.advance(1)
    await ws.send_json({"type": "pong"})
    for _ in range(20):
        if next(iter(relay.connections)).last_seen == 1:
            break
        await asyncio.sleep(0)
    clock.advance(75)

    for _ in range(10):
        message = await ws.receive(timeout=1)
        if message.type is WSMsgType.TEXT:
            assert json.loads(message.data) == {"type": "ping"}
            continue
        assert message.type in {WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED}
        break
    else:
        pytest.fail("idle WebSocket did not close")


@pytest.mark.asyncio
async def test_client_ping_gets_pong(aiohttp_client) -> None:
    client, _ = await make_relay_client(aiohttp_client)
    ws = await connect_and_auth(client, "alice")
    await ws.send_json({"type": "ping"})
    assert await ws.receive_json(timeout=1) == {"type": "pong"}
