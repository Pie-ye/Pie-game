"""派派鎮的伺服器端遊戲服務：玩家資料、農場動作、拜訪、共同耕作、跳蚤市場、釣魚、許願池、海獅表演、鎮民交易所。

所有規則在伺服器執行（plaza_logic.py），瀏覽器只送操作、收結果。資料存在與雲端存檔同一個 SQLite：
  plaza_players（每位玩家一份 JSON）與 plaza_market（市場掛單）。
玩家資料常駐記憶體快取，修改後標記 dirty，每 2 秒批次寫回；掛單也在記憶體，
所有修改都在事件迴圈裡同步完成（中間沒有 await），所以兩個人同時買同一筆不會重複成交。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import random
import re
import time
from typing import Any, Callable

from ..saves import SaveStore
from . import plaza_logic as L

GAME_ID = "pie-plaza"
USER_RE = re.compile(r"^[A-Za-z0-9_.@:-]{1,64}$")
FLUSH_SECONDS = 2.0
TICK_SECONDS = 5.0
MAX_LISTINGS_PER_USER = 10
MAX_COOP = 20
WISH_COST = 10

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS plaza_players (
        user_id    TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        open       INTEGER NOT NULL DEFAULT 1,
        likes      INTEGER NOT NULL DEFAULT 0,
        card       TEXT NOT NULL DEFAULT '{}',
        updated_at REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS plaza_market (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        seller      TEXT NOT NULL,
        seller_name TEXT NOT NULL,
        item        TEXT NOT NULL,
        n           INTEGER NOT NULL,
        price       INTEGER NOT NULL,
        created_at  REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS plaza_exchange (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
    )
    """,
)


class GameError(Exception):
    def __init__(self, code: str, msg: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.msg = msg


class PlazaService:
    GAME_ID = GAME_ID

    def __init__(self, store: SaveStore, *, clock: Callable[[], float] = time.time, rng: random.Random | None = None) -> None:
        self.store = store
        self.clock = clock                     # 秒
        self.rng = rng or random.Random()
        self.players: dict[str, dict[str, Any]] = {}
        self.dirty: set[str] = set()
        self.market: dict[int, dict[str, Any]] = {}
        self.ex: dict[str, Any] = {}
        self.ex_dirty = False
        self._loading: dict[str, asyncio.Future] = {}
        self._tasks: list[asyncio.Task] = []
        self._cast_seq = 0
        with store._lock:
            for statement in SCHEMA:
                store._db.execute(statement)
            for row in store._db.execute("SELECT id, seller, seller_name, item, n, price, created_at FROM plaza_market"):
                self.market[row[0]] = {"id": row[0], "seller": row[1], "sellerName": row[2], "item": row[3], "n": row[4], "price": row[5], "at": row[6]}
            row = store._db.execute("SELECT v FROM plaza_exchange WHERE k='state'").fetchone()
        self.ex = L.sanitize_exchange(json.loads(row[0]) if row else None, self.now_ms())

    def now_ms(self) -> int:
        return int(self.clock() * 1000)

    # ---------- 生命週期 ----------
    def start(self, relay) -> None:
        self._tasks = [asyncio.create_task(self._flush_loop()), asyncio.create_task(self._tick_loop(relay))]

    async def close(self) -> None:
        for task in self._tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks = []
        await self.flush()

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_SECONDS)
            with contextlib.suppress(Exception):
                await self.flush()

    async def flush(self) -> None:
        rows = []
        for uid in list(self.dirty):
            rec = self.players.get(uid)
            if rec is not None:
                rows.append((uid, json.dumps(rec, ensure_ascii=False, separators=(",", ":")), rec["name"], 1 if rec["social"]["open"] else 0,
                             rec["social"]["likes"], json.dumps(self._card(rec), ensure_ascii=False), self.clock()))
        self.dirty.clear()
        ex = json.dumps(self.ex, ensure_ascii=False, separators=(",", ":")) if self.ex_dirty else None
        self.ex_dirty = False
        if rows or ex is not None:
            await asyncio.to_thread(self._write_players, rows, ex)

    def _write_players(self, rows: list[tuple], ex: str | None = None) -> None:
        with self.store._lock:
            if rows:
                self.store._db.executemany(
                    "INSERT INTO plaza_players (user_id, data, name, open, likes, card, updated_at) VALUES (?,?,?,?,?,?,?) "
                    "ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, name=excluded.name, open=excluded.open, "
                    "likes=excluded.likes, card=excluded.card, updated_at=excluded.updated_at", rows)
            if ex is not None:
                self.store._db.execute(
                    "INSERT INTO plaza_exchange (k, v) VALUES ('state', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (ex,))

    async def _tick_loop(self, relay) -> None:
        """有人在看的農場：作物依伺服器時間成長，變化推給所有觀看者。"""
        while True:
            await asyncio.sleep(TICK_SECONDS)
            with contextlib.suppress(Exception):
                owners = {c.viewing for c in list(relay.connections) if c.game_id == GAME_ID and c.viewing}
                for owner in owners:
                    rec = self.players.get(owner)
                    if rec is None:
                        continue
                    changed = L.grow(rec["farm"], self.now_ms())
                    if changed:
                        self.dirty.add(owner)
                        await self._broadcast_patch(relay, owner, changed, by=None, kind="grow")
                await self._run_exchange(relay)

    # ---------- 玩家資料 ----------
    async def load(self, uid: str, name: str | None = None, *, create: bool = True) -> dict[str, Any] | None:
        uid = str(uid)
        rec = self.players.get(uid)
        if rec is None:
            if uid in self._loading:                       # 同一個人同時被載入兩次：等第一個
                await self._loading[uid]
                rec = self.players.get(uid)
            else:
                fut = asyncio.get_running_loop().create_future()
                self._loading[uid] = fut
                try:
                    rec = await asyncio.to_thread(self._read_player, uid, name, create)
                    if rec is not None and uid not in self.players:
                        self.players[uid] = rec
                    rec = self.players.get(uid, rec)
                finally:
                    fut.set_result(None)
                    del self._loading[uid]
        if rec is not None and name and rec["name"] != name:
            rec["name"] = name[:40]
            self.dirty.add(uid)
        return rec

    def _read_player(self, uid: str, name: str | None, create: bool) -> dict[str, Any] | None:
        with self.store._lock:
            row = self.store._db.execute("SELECT data FROM plaza_players WHERE user_id=?", (uid,)).fetchone()
        if row:
            return json.loads(row[0])
        if not create:
            return None
        # 第一次：從舊的雲端存檔匯入（前一版由瀏覽器上傳），沒有就開新農場
        saves = {}
        for key in ("farm", "decor", "look", "social"):
            got = self.store.get_sync(GAME_ID, uid, key)
            if got:
                saves[key] = got["value"]
        rec = L.import_saves(uid, name or "鎮民", saves) if saves else L.new_player(uid, name or "鎮民")
        self.dirty.add(uid)
        return rec

    def _card(self, rec: dict[str, Any]) -> dict[str, Any]:
        d = rec["decor"]
        return {"name": rec["name"], "look": rec["look"], "style": d["style"], "roof": d["ext"]["roof"], "wall": d["ext"]["wall"],
                "likes": rec["social"]["likes"], "crops": len(rec["farm"]["crops"]), "debris": len(rec["farm"]["debris"])}

    def private_view(self, rec: dict[str, Any]) -> dict[str, Any]:
        s = rec["social"]
        return {"name": rec["name"], "farm": L.pack_farm(rec["farm"]), "inv": rec["inv"], "seeds": rec["seeds"], "seedSel": rec["seedSel"],
                "gold": rec["gold"], "shares": L.shares_of(rec), "decor": rec["decor"], "look": rec["look"],
                "social": {"open": s["open"], "friends": s["friends"], "coop": s["coop"], "likes": s["likes"], "liked": s["liked"]},
                "now": self.now_ms()}

    def public_view(self, owner: str, rec: dict[str, Any], viewer: str, online: bool) -> dict[str, Any]:
        return {"owner": owner, "name": rec["name"], "look": rec["look"], "decor": rec["decor"], "farm": L.pack_farm(rec["farm"]),
                "likes": rec["social"]["likes"], "coop": viewer in rec["social"]["coop"], "online": online, "now": self.now_ms()}

    # ---------- 推播 ----------
    async def _send(self, conn, payload: dict[str, Any]) -> None:
        if not conn.ws.closed:
            with contextlib.suppress(ConnectionError, RuntimeError):
                await conn.ws.send_json(payload)

    def _conns_of(self, relay, uid: str) -> list:
        return [c for c in list(relay.connections) if c.game_id == GAME_ID and str(c.user_id) == uid]

    async def _broadcast_patch(self, relay, owner: str, keys: list[str], *, by: str | None, kind: str) -> None:
        rec = self.players[owner]
        payload = {"type": "game", "op": "patch", "owner": owner, "tiles": {k: L.tile(rec["farm"], k) for k in keys}, "by": by, "kind": kind,
                   "now": self.now_ms()}
        for c in list(relay.connections):
            if c.game_id == GAME_ID and c.viewing == owner:
                await self._send(c, payload)

    async def _push_me(self, relay, uid: str, **fields: Any) -> None:
        rec = self.players.get(uid)
        if rec is None:
            return
        payload = {"type": "game", "op": "me", "inv": rec["inv"], "gold": rec["gold"], "seeds": rec["seeds"], "seedSel": rec["seedSel"],
                   "shares": L.shares_of(rec), "likes": rec["social"]["likes"], **fields}
        for c in self._conns_of(relay, uid):
            await self._send(c, payload)

    async def _notify(self, relay, to: str, frm: str, frm_name: str, kind: str, data: dict[str, Any]) -> None:
        """系統信（sys 開頭，一般信箱寄不出來）＋線上推播。"""
        await asyncio.to_thread(self.store.mail_send_sync, GAME_ID, frm, frm_name, to, kind, data)
        for c in self._conns_of(relay, to):
            await self._send(c, {"type": "mail", "from": frm, "kind": kind})

    # ---------- 入口 ----------
    async def handle(self, relay, conn, payload: dict[str, Any]) -> None:
        rid = payload.get("rid") if isinstance(payload.get("rid"), str) and len(payload["rid"]) <= 32 else None
        op = payload.get("op")
        handler = getattr(self, f"op_{op}", None) if isinstance(op, str) and re.match(r"^[a-z_]{1,20}$", op) else None
        if handler is None:
            await self._send(conn, {"type": "error", "code": "bad_game_op", "rid": rid})
            return
        me = str(conn.user_id)
        try:
            rec = await self.load(me, conn.display_name or conn.username)
            out = await handler(relay, conn, me, rec, payload)
        except GameError as err:
            await self._send(conn, {"type": "error", "code": err.code, "msg": err.msg, "rid": rid})
            return
        except (TypeError, ValueError, KeyError):
            await self._send(conn, {"type": "error", "code": "bad_message", "rid": rid})
            return
        await self._send(conn, {"type": "game", "rid": rid, "op": op, "ok": True, **(out or {})})

    @staticmethod
    def _user(v: Any) -> str:
        if not isinstance(v, str) or not USER_RE.match(v):
            raise GameError("bad_user")
        return v

    @staticmethod
    def _int(v: Any, lo: int, hi: int) -> int:
        if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
            raise GameError("bad_message")
        return v

    def _mine(self, rec: dict[str, Any]) -> dict[str, Any]:
        return {"inv": rec["inv"], "gold": rec["gold"], "seeds": rec["seeds"], "seedSel": rec["seedSel"], "shares": L.shares_of(rec)}

    # ---------- 自己 ----------
    async def op_load(self, relay, conn, me, rec, p):
        L.grow(rec["farm"], self.now_ms())
        return {"me": self.private_view(rec)}

    async def op_look(self, relay, conn, me, rec, p):
        look = L.sanitize_look(p.get("look"))
        if look is None:
            raise GameError("bad_look")
        rec["look"] = look
        self.dirty.add(me)
        return {}

    async def op_decor(self, relay, conn, me, rec, p):
        rec["decor"] = L.sanitize_decor(p.get("decor"))
        self.dirty.add(me)
        await self._broadcast_home(relay, me)
        return {"decor": rec["decor"]}

    async def _broadcast_home(self, relay, owner: str) -> None:
        """主人改了小屋：正在看的人重新讀。"""
        for c in list(relay.connections):
            if c.game_id == GAME_ID and c.viewing == owner and str(c.user_id) != owner:
                await self._send(c, {"type": "game", "op": "home", "owner": owner})

    async def op_social(self, relay, conn, me, rec, p):
        s = rec["social"]
        if "open" in p:
            s["open"] = bool(p["open"])
        if "friend" in p:
            fid = self._user(p["friend"])
            on = bool(p.get("on"))
            s["friends"] = [f for f in s["friends"] if f["id"] != fid]
            if on and len(s["friends"]) < 100:
                s["friends"].append({"id": fid, "name": str(p.get("name") or "鎮民")[:20]})
        if "coop" in p:
            cid = self._user(p["coop"])
            if cid == me:
                raise GameError("bad_user")
            s["coop"] = [x for x in s["coop"] if x != cid]
            if p.get("on"):
                if len(s["coop"]) >= MAX_COOP:
                    raise GameError("coop_full", "共同耕作最多 20 人")
                s["coop"].append(cid)
                await self._notify(relay, cid, me, rec["name"], "syscoop", {"on": True})
            await self._broadcast_home(relay, me)
        self.dirty.add(me)
        return {"social": {"open": s["open"], "friends": s["friends"], "coop": s["coop"], "likes": s["likes"], "liked": s["liked"]}}

    async def op_seed(self, relay, conn, me, rec, p):
        k = p.get("crop")
        if k not in L.CROPS or rec["seeds"].get(k, 0) <= 0:
            raise GameError("no_seed")
        rec["seedSel"] = k
        self.dirty.add(me)
        return self._mine(rec)

    async def op_buy(self, relay, conn, me, rec, p):
        discount = 0.8 if p.get("market") and L.event_active("market", self.now_ms()) else 1.0
        r = L.buy_seed(rec, p.get("crop"), p.get("n"), discount)
        if not r["ok"]:
            raise GameError("buy_failed", r["msg"])
        n = p.get("n") if isinstance(p.get("n"), int) else 1
        L.note_act(self.ex, "GROC", max(1, n))
        self.ex_dirty = True
        self.dirty.add(me)
        return {"msg": r["msg"], **self._mine(rec)}

    async def op_ship(self, relay, conn, me, rec, p):
        r = L.ship_all(rec)
        for k, n in r["sold"]:
            if k == "wheat":
                L.note_act(self.ex, "BAKE", n)
            elif isinstance(k, str) and k.startswith("fish_"):
                L.note_act(self.ex, "FISH", n)
        if r["sold"]:
            self.ex_dirty = True
        self.dirty.add(me)
        return {"total": r["total"], "sold": r["sold"], **self._mine(rec)}

    # ---------- 農場與拜訪 ----------
    async def _owner(self, me: str, rec: dict[str, Any], owner: Any, name: str | None = None) -> tuple[str, dict[str, Any]]:
        owner = me if owner is None else self._user(owner)
        if owner == me:
            return me, rec
        orec = await self.load(owner, create=False)
        if orec is None:
            raise GameError("no_such_player", "找不到這位鎮民的家")
        return owner, orec

    def _role(self, me: str, owner: str, orec: dict[str, Any]) -> str:
        if owner == me:
            return "owner"
        if me in orec["social"]["coop"]:
            return "coop"
        return "visitor" if orec["social"]["open"] else "closed"

    async def op_view(self, relay, conn, me, rec, p):
        """進入某人的農場或小屋：回傳畫面需要的資料，之後的變化會推播過來。"""
        owner, orec = await self._owner(me, rec, p.get("owner"))
        role = self._role(me, owner, orec)
        if role == "closed":
            conn.viewing = None
            raise GameError("home_closed", f"{orec['name']}的家園沒有開放拜訪")
        conn.viewing = owner
        if L.grow(orec["farm"], self.now_ms()):
            self.dirty.add(owner)
        online = bool(self._conns_of(relay, owner))
        return {"home": self.public_view(owner, orec, me, online), "role": role}

    async def op_leave(self, relay, conn, me, rec, p):
        conn.viewing = None
        return {}

    async def op_tool(self, relay, conn, me, rec, p):
        owner, orec = await self._owner(me, rec, p.get("owner"))
        tool = p.get("tool")
        x, y = self._int(p.get("x"), 0, 99), self._int(p.get("y"), 0, 99)
        role = self._role(me, owner, orec)
        if tool not in L.FARM_TOOLS:
            raise GameError("bad_tool")
        if role == "closed" or (role == "visitor" and tool != "wateringcan"):
            raise GameError("not_allowed", "這是別人的農場：可以幫忙澆水；要用其他工具得先被邀請共同耕作")
        now = self.now_ms()
        L.grow(orec["farm"], now)
        r = L.use_tool(orec, rec, tool, x, y, now)
        k = f"{x},{y}"
        out = {"result": r, "tile": {k: L.tile(orec["farm"], k)}, **self._mine(rec)}
        if r["ok"]:
            self.dirty.update({owner, me})
            await self._broadcast_patch(relay, owner, [k], by=None if owner == me else rec["name"], kind=tool)
            if owner != me and (r.get("cleared") or r.get("harvest")):
                await self._push_me(relay, owner)             # 掉落物進了主人的背包
        return out

    async def op_like(self, relay, conn, me, rec, p):
        owner, orec = await self._owner(me, rec, p.get("owner"))
        if owner == me:
            raise GameError("bad_user")
        day = L.taipei_day(self.now_ms())
        if rec["social"]["liked"].get(owner) == day:
            raise GameError("already_liked", "今天已經稱讚過了")
        rec["social"]["liked"] = {k: v for k, v in rec["social"]["liked"].items() if v == day}
        rec["social"]["liked"][owner] = day
        orec["social"]["likes"] += 1
        self.dirty.update({owner, me})
        await self._notify(relay, owner, me, rec["name"], "syslike", {})
        await self._push_me(relay, owner)
        return {"likes": orec["social"]["likes"]}

    async def op_gift(self, relay, conn, me, rec, p):
        to, trec = await self._owner(me, rec, p.get("to"))
        item = p.get("item")
        if to == me:
            raise GameError("bad_user")
        if not (item in L.CROPS or (isinstance(item, str) and item.startswith("fish_") and item in L.ITEMS)) or rec["inv"].get(item, 0) <= 0:
            raise GameError("no_item", "背包裡沒有這個東西")
        rec["inv"][item] -= 1
        if not rec["inv"][item]:
            del rec["inv"][item]
        self.dirty.add(me)
        await self._notify(relay, to, me, rec["name"], "sysgift", {"item": item, "n": 1})
        return self._mine(rec)

    async def op_claim(self, relay, conn, me, rec, p):
        """收下禮物或稱讚通知：先刪信再入帳，同一封只會成功一次。"""
        mid = self._int(p.get("id"), 1, 2**62)
        taken = await asyncio.to_thread(self.store.mail_take_sync, GAME_ID, me, mid)
        if taken is None:
            raise GameError("no_mail", "這封信已經處理過了")
        kind, data = taken
        if kind == "sysgift" and data.get("item") in L.ITEMS:
            n = max(1, min(99, int(data.get("n") or 1)))
            rec["inv"][data["item"]] = rec["inv"].get(data["item"], 0) + n
        elif kind in ("syssold", "sysdiv"):
            pass                                                  # 錢在成交／發息時已經入帳，這裡只是讀過
        self.dirty.add(me)
        return self._mine(rec)

    async def op_directory(self, relay, conn, me, rec, p):
        await self.flush()
        rows = await asyncio.to_thread(self._read_directory)
        online = {str(c.user_id) for c in relay.connections if c.game_id == GAME_ID}
        return {"items": [{"user": u, **card, "online": u in online} for u, card in rows if u != me]}

    def _read_directory(self) -> list[tuple[str, dict[str, Any]]]:
        with self.store._lock:
            rows = self.store._db.execute(
                "SELECT user_id, card FROM plaza_players WHERE open=1 ORDER BY likes DESC, updated_at DESC LIMIT 50").fetchall()
        return [(r[0], json.loads(r[1])) for r in rows]

    # ---------- 跳蚤市場 ----------
    async def op_market(self, relay, conn, me, rec, p):
        items = sorted(self.market.values(), key=lambda x: -x["id"])[:200]
        return {"items": items}

    async def op_sell(self, relay, conn, me, rec, p):
        item = p.get("item")
        n = self._int(p.get("n"), 1, 99)
        price = self._int(p.get("price"), 1, 99999)
        if item not in L.ITEMS or rec["inv"].get(item, 0) < n:
            raise GameError("no_item", "背包裡的數量不夠")
        if sum(1 for x in self.market.values() if x["seller"] == me) >= MAX_LISTINGS_PER_USER:
            raise GameError("too_many_listings", f"一個人最多同時上架 {MAX_LISTINGS_PER_USER} 筆")
        rec["inv"][item] -= n
        if not rec["inv"][item]:
            del rec["inv"][item]
        self.dirty.add(me)
        at = self.clock()
        new_id = await asyncio.to_thread(self._insert_listing, me, rec["name"], item, n, price, at)
        self.market[new_id] = {"id": new_id, "seller": me, "sellerName": rec["name"], "item": item, "n": n, "price": price, "at": at}
        return {"listing": self.market[new_id], **self._mine(rec)}

    def _insert_listing(self, seller, name, item, n, price, at) -> int:
        with self.store._lock:
            cur = self.store._db.execute(
                "INSERT INTO plaza_market (seller, seller_name, item, n, price, created_at) VALUES (?,?,?,?,?,?)",
                (seller, name, item, n, price, at))
            return cur.lastrowid

    def _delete_listing(self, lid: int) -> None:
        with self.store._lock:
            self.store._db.execute("DELETE FROM plaza_market WHERE id=?", (lid,))

    async def op_purchase(self, relay, conn, me, rec, p):
        lid = self._int(p.get("id"), 1, 2**62)
        listing = self.market.get(lid)
        if listing is None:
            raise GameError("sold_out", "這筆已經賣掉或下架了")
        if listing["seller"] == me:
            raise GameError("own_listing", "不能買自己的東西")
        seller = await self.load(listing["seller"], create=False)
        listing = self.market.get(lid)                           # 載入賣家時可能被別人買走
        if listing is None or seller is None:
            raise GameError("sold_out", "這筆已經賣掉或下架了")
        if rec["gold"] < listing["price"]:
            raise GameError("no_gold", "金幣不夠")
        # 以下全部同步完成：扣錢、給貨、賣家入帳、移除掛單
        del self.market[lid]
        rec["gold"] -= listing["price"]
        rec["inv"][listing["item"]] = rec["inv"].get(listing["item"], 0) + listing["n"]
        seller["gold"] += listing["price"]
        self.dirty.update({me, listing["seller"]})
        await asyncio.to_thread(self._delete_listing, lid)
        await self._notify(relay, listing["seller"], me, rec["name"], "syssold",
                           {"item": listing["item"], "n": listing["n"], "price": listing["price"]})
        await self._push_me(relay, listing["seller"])
        return {"bought": listing, **self._mine(rec)}

    async def op_unlist(self, relay, conn, me, rec, p):
        lid = self._int(p.get("id"), 1, 2**62)
        listing = self.market.get(lid)
        if listing is None or listing["seller"] != me:
            raise GameError("sold_out", "這筆已經賣掉或下架了")
        del self.market[lid]
        rec["inv"][listing["item"]] = rec["inv"].get(listing["item"], 0) + listing["n"]
        self.dirty.add(me)
        await asyncio.to_thread(self._delete_listing, lid)
        return self._mine(rec)

    # ---------- 釣魚（伺服器抽魚、計時） ----------
    async def op_cast(self, relay, conn, me, rec, p):
        where = p.get("where")
        if where not in ("sea", "pond"):
            raise GameError("bad_message")
        now = self.now_ms()
        contest = where == "sea" and L.event_active("fishing", now)
        fish = L.roll_fish(where, L.taipei(now).tm_hour, contest, self.rng)
        self._cast_seq += 1
        bite = int(1500 + self.rng.random() * 4500)
        conn.cast = {"id": self._cast_seq, "fish": fish["id"], "bite": now + bite, "contest": contest}
        return {"cast": self._cast_seq, "bite": bite, "diff": fish["diff"], "contest": contest}

    async def op_land(self, relay, conn, me, rec, p):
        cast = getattr(conn, "cast", None)
        conn.cast = None
        if not cast or p.get("cast") != cast["id"]:
            raise GameError("no_cast", "沒有在釣魚")
        now = self.now_ms()
        if now < cast["bite"] + 1200 or now > cast["bite"] + 120_000:
            raise GameError("bad_timing", "魚跑掉了")
        fish = L.FISH_BY_ID[cast["fish"]]
        if not p.get("ok"):
            return {"fish": fish["id"], "caught": False}
        size = L.fish_size(fish, self.rng)
        if not fish.get("junk"):
            k = f"fish_{fish['id']}"
            rec["inv"][k] = rec["inv"].get(k, 0) + 1
            L.note_act(self.ex, "FISH", 1)
            self.ex_dirty = True
            self.dirty.add(me)
        return {"fish": fish["id"], "caught": True, "size": size, "contest": cast["contest"], **self._mine(rec)}

    # ---------- 地標：菲比女神噴水池、瑞吉海獅秀 ----------
    async def op_wish(self, relay, conn, me, rec, p):
        if rec["gold"] < WISH_COST:
            raise GameError("no_gold", f"許願要投 {WISH_COST} G")
        rec["gold"] -= WISH_COST
        r = self.rng.random()
        if r < 0.05:
            rec["inv"]["fish_golden"] = rec["inv"].get("fish_golden", 0) + 1
            reward = {"kind": "fish", "item": "fish_golden", "n": 1}
        elif r < 0.20:
            rec["gold"] += 50
            reward = {"kind": "gold", "n": 50}
        elif r < 0.50:
            crop = self.rng.choice(L.CROP_KEYS)
            rec["seeds"][crop] = rec["seeds"].get(crop, 0) + 3
            reward = {"kind": "seed", "item": crop, "n": 3}
        else:
            reward = {"kind": "none"}
        L.note_act(self.ex, "WISH", 1)
        self.ex_dirty = True
        self.dirty.add(me)
        return {"reward": reward, **self._mine(rec)}

    async def op_feed(self, relay, conn, me, rec, p):
        """餵瑞吉一條魚：瑞吉會回禮種子。"""
        item = p.get("item")
        if not (isinstance(item, str) and item.startswith("fish_") and rec["inv"].get(item, 0) > 0):
            raise GameError("no_item", "背包裡沒有魚")
        rec["inv"][item] -= 1
        if not rec["inv"][item]:
            del rec["inv"][item]
        crop = self.rng.choice(L.CROP_KEYS)
        n = 2 if item != "fish_golden" else 10
        rec["seeds"][crop] = rec["seeds"].get(crop, 0) + n
        L.note_act(self.ex, "SHOW", 1)
        self.ex_dirty = True
        self.dirty.add(me)
        return {"reward": {"kind": "seed", "item": crop, "n": n}, **self._mine(rec)}

    # ---------- 派派鎮民交易所 ----------
    async def _run_exchange(self, relay) -> None:
        now = self.now_ms()
        if L.tick_exchange(self.ex, now, self.rng):
            self.ex_dirty = True
        due = L.dividend_due(self.ex, now)
        if not due:
            return
        self.ex["divDay"] = due
        self.ex["divMid"] = dict(self.ex["mid"])
        self.ex_dirty = True
        mids = self.ex["divMid"]
        for uid, rec in list(self.players.items()):
            if rec.get("divDay") == due:
                continue
            gold = L.pay_dividend(rec, mids)
            rec["divDay"] = due
            self.dirty.add(uid)
            if gold:
                await self._notify(relay, uid, "sys", "妮可", "sysdiv", {"gold": gold})
                await self._push_me(relay, uid)

    def _pay_div_for(self, uid: str, rec: dict[str, Any]) -> int:
        due = self.ex.get("divDay")
        if not due or rec.get("divDay") == due:
            return 0
        gold = L.pay_dividend(rec, self.ex.get("divMid") or self.ex["mid"])
        rec["divDay"] = due
        self.dirty.add(uid)
        return gold

    async def op_quote(self, relay, conn, me, rec, p):
        await self._run_exchange(relay)
        div = self._pay_div_for(me, rec)
        view = L.quote_view(self.ex, rec, self.now_ms())
        if div:
            view["div"] = div
            await self._notify(relay, me, "sys", "妮可", "sysdiv", {"gold": div})
        return view

    async def op_trade(self, relay, conn, me, rec, p):
        await self._run_exchange(relay)
        self._pay_div_for(me, rec)
        r = L.apply_trade(rec, self.ex, p.get("side"), p.get("ticker"), p.get("n"), self.now_ms())
        if not r["ok"]:
            raise GameError(r["code"], r["msg"])
        self.dirty.add(me)
        return {**r, **L.quote_view(self.ex, rec, self.now_ms()), **self._mine(rec)}
