#!/usr/bin/env python3
"""本機預覽用的假股票大亂鬥 API（只給畫面檢查與截圖，不是遊戲邏輯）。

  python3 -m server.app --dev &            # 外框 54470、內容 54471
  python3 tools/dev_stub_api.py &          # 假 API 54480
  開 http://localhost:54470/?api=http://127.0.0.1:54480&content=http://127.0.0.1:54471

回應的牌與結果是固定的，目的是讓每個官方賭場遊戲都能進到「有牌、有結果」的畫面。
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from aiohttp import web

ROOT = Path(__file__).resolve().parents[1]
PORT = 54480
SHELL_ORIGINS = {"http://localhost:54470", "http://127.0.0.1:54470", "http://localhost:54472", "http://100.82.35.84:54470"}
STATE = {"balance": 1000, "bj": None, "dg": None}
SYMBOLS = ["brand", "gem", "rocket", "bank", "flame", "trend", "candles", "coins"]
BETS = [5, 10, 20, 50, 100]
CFG = {"minBet": 5, "maxBet": 100, "bets": BETS}


def _community_specs() -> list[dict]:
    specs = []
    for path in sorted((ROOT / "site/games/community").glob("*/spec.json")):
        if path.parent.name.startswith("_"):
            continue
        spec = json.loads(path.read_text())
        meta = json.loads((path.parent / "game.json").read_text())
        choices = [{"id": c["id"], "label": c["label"], "rtp": 0.96} for c in spec["choices"]]
        specs.append({"id": spec["id"], "name": meta.get("name", spec["id"]), "author": meta.get("author", ""),
                      "minBet": spec["minBet"], "maxBet": spec["maxBet"], "choices": choices, "sha256": "stub"})
    return specs


def _json(request: web.Request, body: dict, status: int = 200) -> web.Response:
    origin = request.headers.get("Origin", "")
    headers = {}
    if origin in SHELL_ORIGINS:
        headers = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin"}
    return web.json_response(body, status=status, headers=headers)


def _bal() -> dict:
    return {"balance": STATE["balance"]}


async def options(request: web.Request) -> web.Response:
    origin = request.headers.get("Origin", "")
    return web.Response(status=204, headers={
        "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"})


async def handle(request: web.Request) -> web.Response:
    path = request.path
    body = await request.json() if request.can_read_body else {}
    user = {"id": "u-stub", "username": "stub", "displayName": "Stub"}
    if path == "/api/auth/login":
        return _json(request, {"user": user, "csrfToken": "stub-csrf"})
    if path == "/api/casino/session":
        return _json(request, {"user": user, "balance": STATE["balance"], "csrfToken": "stub-csrf"})
    if path == "/api/casino/play-ticket":
        return _json(request, {"ticket": f"{body.get('gameId', 'x')}|{id(request) % 100000}"})
    if path == "/api/casino/play-ticket/redeem":
        # 多人遊戲預覽：ticket 格式「遊戲id|序號」，序號當玩家身分
        game_id, _, seq = str(body.get("ticket", "")).partition("|")
        return _json(request, {"userId": "u-" + seq, "username": "stub" + seq, "displayName": "玩家" + seq, "gameId": game_id})
    if path == "/api/casino/history":
        return _json(request, {"game": "", "items": [], "summary": {"rounds": 0, "bet": 0, "payout": 0, "net": 0}})
    if path == "/api/casino/community":
        return _json(request, {"games": _community_specs(), "rejected": []})
    if path == "/api/casino/slots/config":
        return _json(request, {"bets": [1, 5, 10, 20], "symbols": SYMBOLS, "twoCoinsMult": 1, "rtp": 0.95,
                               "paytable": dict(zip(SYMBOLS, [100, 50, 25, 15, 10, 6, 4, 2])), **_bal()})
    if path == "/api/casino/slots/spin":
        reels = [[random.choice(SYMBOLS) for _ in range(3)] for _ in range(3)]
        if random.random() < 0.5:
            sym = random.choice(SYMBOLS)
            for r in reels:
                r[1] = sym
        line = [r[1] for r in reels]
        win = line[0] == line[1] == line[2]
        payout = body.get("bet", 5) * 10 if win else 0
        STATE["balance"] += payout - body.get("bet", 5)
        return _json(request, {"roundId": "r", "reels": reels, "line": line, "payout": payout, "bet": body.get("bet", 5), **_bal()})
    if path in ("/api/casino/baccarat/config", "/api/casino/baccarat"):
        return _json(request, {**CFG, "odds": {"player": 1, "banker": 0.95, "tie": 8}, **_bal()})
    if path == "/api/casino/baccarat/play":
        bet = body.get("bet", 10)
        STATE["balance"] += bet
        return _json(request, {"roundId": f"bc{random.random()}", "result": "player", "player": ["Ks", "7h", "2d"], "banker": ["5c", "Td"],
                               "playerTotal": 9, "bankerTotal": 5, "bet": bet, "payout": bet * 2, "net": bet, **_bal()})
    if path == "/api/casino/niuniu/config":
        return _json(request, {**CFG, "lockMult": 5, **_bal()})
    if path == "/api/casino/niuniu/play":
        bet = body.get("bet", 10)
        return _json(request, {"roundId": "nn", "winner": "player", "mult": 3, "net": bet * 3,
                               "player": ["Ks", "Qh", "Jd", "3c", "7s"], "banker": ["2s", "4h", "9d", "Tc", "5s"],
                               "playerHand": {"name": "牛牛"}, "bankerHand": {"name": "牛九"}, **_bal()})
    if path == "/api/casino/blackjack":
        return _json(request, {"phase": "idle", "config": CFG, **_bal()})
    if path == "/api/casino/blackjack/deal":
        view = {"phase": "player", "config": CFG, "dealer": ["Ks", "??"], "dealerVisibleTotal": 10, "active": 0,
                "hands": [{"cards": ["8h", "8c"], "bet": body.get("bet", 10), "status": "playing", "total": 16, "soft": False}],
                "canHit": True, "canStand": True, "canDouble": True, "canSplit": True, **_bal()}
        STATE["bj"] = view
        return _json(request, view)
    if path == "/api/casino/blackjack/action":
        result = {"dealer": ["Ks", "6d", "9h"], "dealerTotal": 25, "totalPayout": 20,
                  "hands": [{"cards": ["8h", "8c", "3d"], "bet": 10, "total": 19, "outcome": "win", "payout": 20}]}
        STATE["bj"] = {"phase": "settled", "config": CFG, "result": result, **_bal()}
        return _json(request, STATE["bj"])
    if path == "/api/casino/dragon":
        return _json(request, {"phase": "idle", "config": CFG, **_bal()})
    if path == "/api/casino/dragon/deal":
        STATE["dg"] = {"phase": "dealt", "config": CFG, "gates": ["4h", "Jd"], "pair": False,
                       "options": [{"choice": "inside", "winRanks": 6, "payout": 1.2, "pillarMult": 2}], **_bal()}
        return _json(request, STATE["dg"])
    if path in ("/api/casino/dragon/bet", "/api/casino/dragon/pass"):
        STATE["dg"] = {"phase": "settled", "config": CFG, "gates": ["4h", "Jd"], "third": "8s", "pair": False, "outcome": "win", "net": 12, **_bal()}
        return _json(request, STATE["dg"])
    m = path.split("/")
    if len(m) == 6 and m[3] == "community" and m[5] == "play":
        spec = next((s for s in _community_specs() if s["id"] == m[4]), None)
        if not spec:
            return _json(request, {"error": "not found"}, 404)
        bet = body.get("bet", 5)
        index = random.randrange(8)
        face = random.choice(["heads", "tails"])
        STATE["balance"] -= bet
        return _json(request, {"roundId": "c", "gameId": m[4], "choice": body.get("choice"), "outcome": {"id": "x", "label": "x"},
                               "display": [{"index": index, "face": face}], "bet": bet, "payout": 0, "net": -bet, **_bal()})
    return _json(request, {"error": "not found"}, 404)


def main() -> None:
    app = web.Application()
    app.router.add_route("OPTIONS", "/{tail:.*}", options)
    app.router.add_route("*", "/{tail:.*}", handle)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
