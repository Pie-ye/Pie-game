"""Client for redeeming one-time play tickets."""

from __future__ import annotations

import os
from typing import Any

import aiohttp


async def redeem(ticket: str, *, base: str | None = None) -> dict[str, Any]:
    """Redeem *ticket* with the local Retire-count service."""

    configured_base = (
        base
        if base is not None
        else os.environ.get("PG_RETIRE_BASE", "http://127.0.0.1:54432")
    )
    base_url = configured_base.rstrip("/")
    timeout = aiohttp.ClientTimeout(total=3)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            f"{base_url}/api/casino/play-ticket/redeem",
            json={"ticket": ticket},
        ) as response:
            if response.status != 200:
                raise ValueError("ticket_redeem_failed")
            payload = await response.json()

    if not isinstance(payload, dict):
        raise ValueError("invalid_redeem_response")
    return payload
