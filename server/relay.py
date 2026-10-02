"""Authenticated, game-isolated WebSocket room relay."""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from aiohttp import WSMsgType, web

from . import retire_client

MAX_MESSAGE_BYTES = 16 * 1024
MAX_MESSAGES_PER_SECOND = 20
MAX_ROOMS_PER_GAME = 200
MAX_PLAYERS_PER_ROOM = 16
MAX_CONNECTIONS_PER_USER = 3
MAX_CONNECTIONS = 2_000
AUTH_TIMEOUT_SECONDS = 5
EMPTY_ROOM_TTL_SECONDS = 60
PING_INTERVAL_SECONDS = 25
IDLE_TIMEOUT_SECONDS = 75

PRIVATE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

RedeemCallable = Callable[[str], Awaitable[dict[str, Any]] | dict[str, Any]]
ClockCallable = Callable[[], float]


@dataclass(eq=False, slots=True)
class Connection:
    ws: web.WebSocketResponse
    user_id: Any
    username: str
    display_name: str
    game_id: str
    last_seen: float
    room_id: str | None = None
    message_times: deque[float] = field(default_factory=deque)
    heartbeat_task: asyncio.Task[None] | None = None

    @property
    def player(self) -> dict[str, Any]:
        return {
            "id": self.user_id,
            "username": self.username,
            "displayName": self.display_name,
        }


@dataclass(slots=True)
class Room:
    id: str
    game_id: str
    max_players: int
    private: bool
    name: str | None
    code: str | None
    players: list[Connection] = field(default_factory=list)
    host: Connection | None = None
    state: dict[str, Any] = field(default_factory=dict)
    empty_since: float | None = None

    def snapshot(self, *, include_code: bool = False) -> dict[str, Any]:
        result: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "private": self.private,
            "maxPlayers": self.max_players,
            "playerCount": len(self.players),
        }
        if include_code and self.code is not None:
            result["code"] = self.code
        return result


class Relay:
    """In-memory room service used by the content application."""

    def __init__(
        self,
        content_origin: str,
        *,
        redeem: RedeemCallable | None = None,
        clock: ClockCallable = time.monotonic,
        auth_timeout: float = AUTH_TIMEOUT_SECONDS,
        empty_room_ttl: float = EMPTY_ROOM_TTL_SECONDS,
        ping_interval: float = PING_INTERVAL_SECONDS,
        idle_timeout: float = IDLE_TIMEOUT_SECONDS,
        max_message_bytes: int = MAX_MESSAGE_BYTES,
        max_messages_per_second: int = MAX_MESSAGES_PER_SECOND,
        max_rooms_per_game: int = MAX_ROOMS_PER_GAME,
        max_players_per_room: int = MAX_PLAYERS_PER_ROOM,
        max_connections_per_user: int = MAX_CONNECTIONS_PER_USER,
        max_connections: int = MAX_CONNECTIONS,
    ) -> None:
        self.content_origin = content_origin.rstrip("/")
        self._redeem = redeem
        self.clock = clock
        self.auth_timeout = auth_timeout
        self.empty_room_ttl = empty_room_ttl
        self.ping_interval = ping_interval
        self.idle_timeout = idle_timeout
        self.max_message_bytes = max_message_bytes
        self.max_messages_per_second = max_messages_per_second
        self.max_rooms_per_game = max_rooms_per_game
        self.max_players_per_room = max_players_per_room
        self.max_connections_per_user = max_connections_per_user
        self.max_connections = max_connections

        self.rooms: dict[str, Room] = {}
        self.connections_by_user: dict[Any, set[Connection]] = defaultdict(set)
        self.connections: set[Connection] = set()
        self._pending_connections = 0
        self._cleanup_task: asyncio.Task[None] | None = None
        self._closing = False

    async def start(self) -> None:
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def close(self) -> None:
        self._closing = True
        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._cleanup_task
            self._cleanup_task = None

        sockets = [connection.ws for connection in self.connections]
        if sockets:
            await asyncio.gather(
                *(socket.close(code=1001, message=b"server shutdown") for socket in sockets),
                return_exceptions=True,
            )

    async def websocket_handler(self, request: web.Request) -> web.StreamResponse:
        if request.headers.get("Origin") != self.content_origin:
            raise web.HTTPForbidden(text="invalid Origin")
        if len(self.connections) + self._pending_connections >= self.max_connections:
            raise web.HTTPServiceUnavailable(text="connection limit reached")

        ws = web.WebSocketResponse(autoping=True, max_msg_size=MAX_MESSAGE_BYTES)
        await ws.prepare(request)
        self._pending_connections += 1
        connection: Connection | None = None

        try:
            connection = await self._authenticate(ws)
            if connection is None:
                return ws

            self._pending_connections -= 1
            self.connections.add(connection)
            await ws.send_json({"type": "welcome", "you": connection.player})
            connection.heartbeat_task = asyncio.create_task(self._heartbeat(connection))

            async for message in ws:
                connection.last_seen = self.clock()
                if message.type is WSMsgType.TEXT:
                    await self._handle_text(connection, message.data)
                elif message.type is WSMsgType.BINARY:
                    await self._send_error(connection, "bad_message")
                elif message.type in {WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR}:
                    break
        finally:
            if connection is None:
                self._pending_connections = max(0, self._pending_connections - 1)
            else:
                if connection.heartbeat_task is not None:
                    connection.heartbeat_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await connection.heartbeat_task
                await self._leave_room(connection)
                self.connections.discard(connection)
                user_connections = self.connections_by_user.get(connection.user_id)
                if user_connections is not None:
                    user_connections.discard(connection)
                    if not user_connections:
                        self.connections_by_user.pop(connection.user_id, None)
            if not ws.closed:
                await ws.close()

        return ws

    async def _authenticate(self, ws: web.WebSocketResponse) -> Connection | None:
        try:
            message = await ws.receive(timeout=self.auth_timeout)
        except (asyncio.TimeoutError, TimeoutError):
            await self._send_ws_error(ws, "auth_timeout")
            await ws.close(code=1008, message=b"authentication timeout")
            return None

        if message.type is not WSMsgType.TEXT:
            await self._send_ws_error(ws, "auth_required")
            await ws.close(code=1008, message=b"authentication required")
            return None
        if len(message.data.encode("utf-8")) > self.max_message_bytes:
            await self._send_ws_error(ws, "message_too_large")
            await ws.close(code=1009, message=b"message too large")
            return None

        try:
            payload = json.loads(message.data)
        except (json.JSONDecodeError, TypeError):
            payload = None
        if not isinstance(payload, dict) or payload.get("type") != "auth":
            await self._send_ws_error(ws, "auth_required")
            await ws.close(code=1008, message=b"authentication required")
            return None

        ticket = payload.get("ticket")
        game_id = payload.get("gameId")
        if not isinstance(ticket, str) or not ticket or not isinstance(game_id, str) or not game_id:
            await self._send_ws_error(ws, "bad_message")
            await ws.close(code=1008, message=b"invalid authentication")
            return None

        try:
            redeem_callable = self._redeem or retire_client.redeem
            redeemed = redeem_callable(ticket)
            if inspect.isawaitable(redeemed):
                redeemed = await redeemed
        except Exception:
            await self._send_ws_error(ws, "auth_failed")
            await ws.close(code=1008, message=b"authentication failed")
            return None

        if not isinstance(redeemed, dict) or redeemed.get("gameId") != game_id:
            await self._send_ws_error(ws, "game_mismatch")
            await ws.close(code=1008, message=b"game mismatch")
            return None

        user_id = redeemed.get("userId")
        username = redeemed.get("username")
        display_name = redeemed.get("displayName")
        if (
            isinstance(user_id, bool)
            or not isinstance(user_id, (str, int))
            or not isinstance(username, str)
            or not isinstance(display_name, str)
        ):
            await self._send_ws_error(ws, "auth_failed")
            await ws.close(code=1008, message=b"invalid authentication response")
            return None

        connection = Connection(
            ws=ws,
            user_id=user_id,
            username=username,
            display_name=display_name,
            game_id=game_id,
            last_seen=self.clock(),
        )
        if not self._reserve_user_slot(connection):
            await self._send_ws_error(ws, "too_many_connections")
            await ws.close(code=1008, message=b"connection limit reached")
            return None

        return connection

    async def _handle_text(self, connection: Connection, raw_message: str) -> None:
        if len(raw_message.encode("utf-8")) > self.max_message_bytes:
            await self._send_error(connection, "message_too_large")
            return

        now = self.clock()
        window = connection.message_times
        while window and now - window[0] >= 1:
            window.popleft()
        if len(window) >= self.max_messages_per_second:
            await self._send_error(connection, "rate_limited")
            return
        window.append(now)

        try:
            payload = json.loads(raw_message)
        except (json.JSONDecodeError, TypeError):
            await self._send_error(connection, "bad_message")
            return
        if not isinstance(payload, dict) or not isinstance(payload.get("type"), str):
            await self._send_error(connection, "bad_message")
            return

        message_type = payload["type"]
        handlers = {
            "list": self._list_rooms,
            "create": self._create_room,
            "join": self._join_room,
            "leave": self._leave_command,
            "send": self._relay_message,
            "setState": self._set_state,
            "kick": self._kick,
            "ping": self._client_ping,
            "pong": self._client_pong,
        }
        handler = handlers.get(message_type)
        if handler is None:
            await self._send_error(connection, "bad_message")
            return
        await handler(connection, payload)

    async def _list_rooms(self, connection: Connection, _: dict[str, Any]) -> None:
        rooms = [
            room.snapshot()
            for room in self.rooms.values()
            if room.game_id == connection.game_id and not room.private
        ]
        await connection.ws.send_json({"type": "rooms", "rooms": rooms})

    async def _create_room(self, connection: Connection, payload: dict[str, Any]) -> None:
        if connection.room_id is not None:
            await self._send_error(connection, "already_in_room")
            return

        max_players = payload.get("maxPlayers", self.max_players_per_room)
        private = payload.get("private", False)
        name = payload.get("name")
        if (
            isinstance(max_players, bool)
            or not isinstance(max_players, int)
            or not 1 <= max_players <= self.max_players_per_room
        ):
            await self._send_error(connection, "invalid_max_players")
            return
        if not isinstance(private, bool) or (name is not None and not isinstance(name, str)):
            await self._send_error(connection, "bad_message")
            return
        game_room_count = sum(room.game_id == connection.game_id for room in self.rooms.values())
        if game_room_count >= self.max_rooms_per_game:
            await self._send_error(connection, "room_limit")
            return

        room_id = self._new_room_id()
        code = self._new_private_code() if private else None
        room = Room(
            id=room_id,
            game_id=connection.game_id,
            max_players=max_players,
            private=private,
            name=name,
            code=code,
            players=[connection],
            host=connection,
        )
        self.rooms[room_id] = room
        connection.room_id = room_id
        await self._send_joined(connection, room)

    async def _join_room(self, connection: Connection, payload: dict[str, Any]) -> None:
        if connection.room_id is not None:
            await self._send_error(connection, "already_in_room")
            return

        room_id = payload.get("roomId")
        code = payload.get("code")
        if room_id is not None and not isinstance(room_id, str):
            await self._send_error(connection, "bad_message")
            return
        if code is not None and not isinstance(code, str):
            await self._send_error(connection, "bad_message")
            return
        if not room_id and not code:
            await self._send_error(connection, "bad_message")
            return

        room: Room | None = None
        if room_id:
            candidate = self.rooms.get(room_id)
            if (
                candidate is not None
                and candidate.game_id == connection.game_id
                and not candidate.private
            ):
                room = candidate
        else:
            normalized_code = code.upper() if code else ""
            room = next(
                (
                    candidate
                    for candidate in self.rooms.values()
                    if candidate.game_id == connection.game_id and candidate.code == normalized_code
                ),
                None,
            )
        if room is None:
            await self._send_error(connection, "room_not_found")
            return
        if any(player.user_id == connection.user_id for player in room.players):
            await self._send_error(connection, "already_joined")
            return
        if len(room.players) >= room.max_players:
            await self._send_error(connection, "room_full")
            return

        existing_players = list(room.players)
        room.players.append(connection)
        room.empty_since = None
        connection.room_id = room.id
        if room.host is None:
            room.host = connection

        await self._send_joined(connection, room)
        await self._broadcast(
            existing_players,
            {"type": "playerJoined", "player": connection.player},
        )

    async def _leave_command(self, connection: Connection, _: dict[str, Any]) -> None:
        if connection.room_id is None:
            await self._send_error(connection, "not_in_room")
            return
        await self._leave_room(connection)

    async def _leave_room(self, connection: Connection) -> None:
        if connection.room_id is None:
            return
        room = self.rooms.get(connection.room_id)
        connection.room_id = None
        if room is None or connection not in room.players:
            return

        was_host = room.host is connection
        room.players.remove(connection)
        await self._broadcast(
            room.players,
            {"type": "playerLeft", "playerId": connection.user_id},
        )
        if not room.players:
            room.host = None
            room.empty_since = self.clock()
        elif was_host:
            room.host = room.players[0]
            await self._broadcast(
                room.players,
                {"type": "hostChanged", "hostId": room.host.user_id},
            )

    async def _relay_message(self, connection: Connection, payload: dict[str, Any]) -> None:
        room = self._room_for(connection)
        if room is None:
            await self._send_error(connection, "not_in_room")
            return
        if "data" not in payload:
            await self._send_error(connection, "bad_message")
            return

        target_id = payload.get("to")
        message = {"type": "message", "from": connection.user_id, "data": payload["data"]}
        if target_id is None:
            await self._broadcast(room.players, message)
            return

        target = next((player for player in room.players if player.user_id == target_id), None)
        if target is None:
            await self._send_error(connection, "player_not_found")
            return
        await self._broadcast([target], message)

    async def _set_state(self, connection: Connection, payload: dict[str, Any]) -> None:
        room = self._room_for(connection)
        if room is None:
            await self._send_error(connection, "not_in_room")
            return
        if room.host is not connection:
            await self._send_error(connection, "not_host")
            return
        key = payload.get("key")
        if not isinstance(key, str) or not key or "value" not in payload:
            await self._send_error(connection, "bad_message")
            return

        room.state[key] = payload["value"]
        await self._broadcast(
            room.players,
            {"type": "state", "key": key, "value": payload["value"]},
        )

    async def _kick(self, connection: Connection, payload: dict[str, Any]) -> None:
        room = self._room_for(connection)
        if room is None:
            await self._send_error(connection, "not_in_room")
            return
        if room.host is not connection:
            await self._send_error(connection, "not_host")
            return
        target_id = payload.get("playerId")
        target = next(
            (
                player
                for player in room.players
                if player.user_id == target_id and player is not connection
            ),
            None,
        )
        if target is None:
            await self._send_error(connection, "player_not_found")
            return

        await self._send_error(target, "kicked")
        await self._leave_room(target)

    async def _client_ping(self, connection: Connection, _: dict[str, Any]) -> None:
        await connection.ws.send_json({"type": "pong"})

    async def _client_pong(self, _: Connection, __: dict[str, Any]) -> None:
        return

    async def _send_joined(self, connection: Connection, room: Room) -> None:
        await connection.ws.send_json(
            {
                "type": "joined",
                "room": room.snapshot(include_code=True),
                "players": [player.player for player in room.players],
                "hostId": room.host.user_id if room.host is not None else None,
                "state": dict(room.state),
            }
        )

    async def _send_error(self, connection: Connection, code: str) -> None:
        await self._send_ws_error(connection.ws, code)

    @staticmethod
    async def _send_ws_error(ws: web.WebSocketResponse, code: str) -> None:
        if not ws.closed:
            with contextlib.suppress(ConnectionError, RuntimeError):
                await ws.send_json({"type": "error", "code": code})

    @staticmethod
    async def _broadcast(connections: list[Connection], payload: dict[str, Any]) -> None:
        if connections:
            await asyncio.gather(
                *(connection.ws.send_json(payload) for connection in list(connections) if not connection.ws.closed),
                return_exceptions=True,
            )

    def _room_for(self, connection: Connection) -> Room | None:
        if connection.room_id is None:
            return None
        return self.rooms.get(connection.room_id)

    def _reserve_user_slot(self, connection: Connection) -> bool:
        user_connections = self.connections_by_user[connection.user_id]
        if len(user_connections) >= self.max_connections_per_user:
            return False
        user_connections.add(connection)
        return True

    def _new_room_id(self) -> str:
        while True:
            room_id = secrets.token_urlsafe(9)
            if room_id not in self.rooms:
                return room_id

    def _new_private_code(self) -> str:
        existing_codes = {room.code for room in self.rooms.values() if room.code is not None}
        while True:
            code = "".join(secrets.choice(PRIVATE_CODE_ALPHABET) for _ in range(6))
            if code not in existing_codes:
                return code

    async def cleanup_empty_rooms(self) -> None:
        now = self.clock()
        expired = [
            room_id
            for room_id, room in self.rooms.items()
            if not room.players
            and room.empty_since is not None
            and now - room.empty_since >= self.empty_room_ttl
        ]
        for room_id in expired:
            self.rooms.pop(room_id, None)

    async def _cleanup_loop(self) -> None:
        while not self._closing:
            await asyncio.sleep(min(5.0, max(0.05, self.empty_room_ttl / 2)))
            await self.cleanup_empty_rooms()

    async def _heartbeat(self, connection: Connection) -> None:
        while not connection.ws.closed:
            await asyncio.sleep(self.ping_interval)
            if self.clock() - connection.last_seen >= self.idle_timeout:
                await connection.ws.close(code=1001, message=b"idle timeout")
                return
            try:
                await connection.ws.send_json({"type": "ping"})
            except asyncio.CancelledError:
                raise
            except Exception:
                with contextlib.suppress(Exception):
                    await connection.ws.close(code=1001, message=b"heartbeat failed")
                return
