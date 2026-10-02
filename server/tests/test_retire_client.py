from __future__ import annotations

import pytest
from aiohttp import web

from server.retire_client import redeem


@pytest.mark.asyncio
async def test_redeem_posts_ticket_and_returns_identity(aiohttp_server, monkeypatch) -> None:
    seen: list[dict[str, str]] = []

    async def handler(request: web.Request) -> web.Response:
        seen.append(await request.json())
        return web.json_response(
            {
                "userId": 7,
                "username": "alice",
                "displayName": "Alice",
                "gameId": "maze",
            }
        )

    app = web.Application()
    app.router.add_post("/api/casino/play-ticket/redeem", handler)
    server = await aiohttp_server(app)
    monkeypatch.setenv("PG_RETIRE_BASE", str(server.make_url("/")).rstrip("/"))

    result = await redeem("one-use-ticket")

    assert seen == [{"ticket": "one-use-ticket"}]
    assert result == {
        "userId": 7,
        "username": "alice",
        "displayName": "Alice",
        "gameId": "maze",
    }


@pytest.mark.asyncio
async def test_redeem_rejects_non_200(aiohttp_server, monkeypatch) -> None:
    async def handler(_: web.Request) -> web.Response:
        return web.json_response({"error": "invalid"}, status=400)

    app = web.Application()
    app.router.add_post("/api/casino/play-ticket/redeem", handler)
    server = await aiohttp_server(app)
    monkeypatch.setenv("PG_RETIRE_BASE", str(server.make_url("/")).rstrip("/"))

    with pytest.raises(ValueError, match="ticket_redeem_failed"):
        await redeem("bad-ticket")
