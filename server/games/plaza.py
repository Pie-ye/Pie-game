"""派派鎮的伺服器端遊戲服務：玩家資料、農場動作、拜訪、共同耕作、跳蚤市場、釣魚、許願池、海獅表演、鎮民交易所、廣場常駐派對（搶寶／捉迷藏／傳南瓜／拔河／搬寶／紅綠燈／占席／砸罐／搶瓶）。

所有規則在伺服器執行（plaza_logic.py），瀏覽器只送操作、收結果。資料存在與雲端存檔同一個 SQLite：
  plaza_players（每位玩家一份 JSON）與 plaza_market（市場掛單）。
玩家資料常駐記憶體快取，修改後標記 dirty，每 2 秒批次寫回；掛單也在記憶體，
所有修改都在事件迴圈裡同步完成（中間沒有 await），所以兩個人同時買同一筆不會重複成交。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import re
import time
from typing import Any, Callable

from ..saves import SaveStore
from . import plaza_logic as L
from . import arena as AR
from . import quests as Q
from . import party_bots as PB
from . import boss as BS
from . import town as TW
from . import pets as PT
from . import hunt as HU
from . import friends as FR

GAME_ID = "pie-plaza"
log = logging.getLogger("pie.plaza")
USER_RE = re.compile(r"^[A-Za-z0-9_.@:-]{1,64}$")
FLUSH_SECONDS = 2.0
TICK_SECONDS = 5.0
ARENA_SECONDS = 0.1
MAX_LISTINGS_PER_USER = 10
MAX_COOP = 20
WISH_COST = 10
WISH_DAILY = 10            # 每天許願次數（期望值接近打平，避免刷錢）
PARTY_DAILY_PAID = 12     # 九個廣場派對合計，每天前幾場有獎金

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
        self.party: dict[str, Any] = L.new_party()
        self.contest: dict[str, Any] = L.new_contest()
        self.seek: dict[str, Any] = L.new_seek()
        self.hot: dict[str, Any] = L.new_hot()
        self.tug: dict[str, Any] = L.new_tug()
        self.haul: dict[str, Any] = L.new_haul()
        self.light: dict[str, Any] = L.new_light()
        self.hill: dict[str, Any] = L.new_hill()
        self.smash: dict[str, Any] = L.new_smash()
        self.vase: dict[str, Any] = L.new_vase()
        self.arena = AR.Arena(self.rng)
        self.boss = BS.Boss(self.rng)
        self._boss_started = 0
        self._boss_warned = 0
        self._arena_seen = 0
        self._arena_last = 0
        self._arena_called = False
        self._bot_wait: dict[str, int] = {}
        self._bot_next: dict[tuple[str, str], int] = {}
        self._bot_memo: dict[tuple[str, str], dict[str, Any]] = {}
        self._party_called: dict[str, Any] = {}
        self._spotlight = PB.spotlight_at
        self._bots_at = 0
        self._fw_sec = 0
        with store._lock:
            for statement in SCHEMA:
                store._db.execute(statement)
            for row in store._db.execute("SELECT id, seller, seller_name, item, n, price, created_at FROM plaza_market"):
                self.market[row[0]] = {"id": row[0], "seller": row[1], "sellerName": row[2], "item": row[3], "n": row[4], "price": row[5], "at": row[6]}
            row = store._db.execute("SELECT v FROM plaza_exchange WHERE k='state'").fetchone()
            trow = store._db.execute("SELECT v FROM plaza_exchange WHERE k='town'").fetchone()
            wrow = store._db.execute("SELECT v FROM plaza_exchange WHERE k='weekly'").fetchone()
        self.ex = L.sanitize_exchange(json.loads(row[0]) if row else None, self.now_ms())
        self.town = TW.sanitize(json.loads(trow[0]) if trow else None)
        self.town_dirty = False
        self._apply_town_effects()
        self.weekly: dict[str, Any] = json.loads(wrow[0]) if wrow else {}
        self._week_check = 0
        self._rank_cache: tuple[int, str, dict[str, Any]] | None = None

    def now_ms(self) -> int:
        return int(self.clock() * 1000)

    # ---------- 生命週期 ----------
    def start(self, relay) -> None:
        self._tasks = [asyncio.create_task(self._flush_loop()), asyncio.create_task(self._tick_loop(relay)),
                       asyncio.create_task(self._arena_loop(relay))]

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
        town = json.dumps(self.town, ensure_ascii=False, separators=(",", ":")) if self.town_dirty else None
        self.town_dirty = False
        if rows or ex is not None or town is not None:
            try:
                await asyncio.to_thread(self._write_players, rows, ex, town)
            except Exception:                          # 寫入失敗：標記回去，下一輪重試
                self.dirty.update(r[0] for r in rows)
                self.ex_dirty = self.ex_dirty or ex is not None
                self.town_dirty = self.town_dirty or town is not None
                log.exception("plaza flush failed")
                raise

    def _write_players(self, rows: list[tuple], ex: str | None = None, town: str | None = None) -> None:
        with self.store._lock:
            if rows:
                self.store._db.executemany(
                    "INSERT INTO plaza_players (user_id, data, name, open, likes, card, updated_at) VALUES (?,?,?,?,?,?,?) "
                    "ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, name=excluded.name, open=excluded.open, "
                    "likes=excluded.likes, card=excluded.card, updated_at=excluded.updated_at", rows)
            if ex is not None:
                self.store._db.execute(
                    "INSERT INTO plaza_exchange (k, v) VALUES ('state', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (ex,))
            if town is not None:
                self.store._db.execute(
                    "INSERT INTO plaza_exchange (k, v) VALUES ('town', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (town,))

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
                before = (self.party or {}).get("status")
                L.maybe_expire_party(self.party, self.now_ms())
                paid = await self._pay_party(relay)
                after = (self.party or {}).get("status")
                if paid or before != after:
                    await self._broadcast_party(relay)
                c_before = (self.contest or {}).get("status")
                L.maybe_expire_contest(self.contest, self.now_ms())
                c_paid = await self._pay_contest(relay)
                c_after = (self.contest or {}).get("status")
                if c_paid or c_before != c_after:
                    await self._broadcast_contest(relay)
                s_before = (self.seek or {}).get("status")
                L.maybe_expire_seek(self.seek, self.now_ms())
                s_paid = await self._pay_seek(relay)
                s_after = (self.seek or {}).get("status")
                if s_paid or s_before != s_after:
                    await self._broadcast_seek(relay)
                h_before = (self.hot or {}).get("status")
                L.maybe_expire_hot(self.hot, self.now_ms())
                h_paid = await self._pay_hot(relay)
                h_after = (self.hot or {}).get("status")
                if h_paid or h_before != h_after:
                    await self._broadcast_hot(relay)
                t_before = (self.tug or {}).get("status")
                L.maybe_expire_tug(self.tug, self.now_ms())
                t_paid = await self._pay_tug(relay)
                t_after = (self.tug or {}).get("status")
                if t_paid or t_before != t_after:
                    await self._broadcast_tug(relay)
                u_before = (self.haul or {}).get("status")
                L.maybe_expire_haul(self.haul, self.now_ms())
                u_paid = await self._pay_haul(relay)
                u_after = (self.haul or {}).get("status")
                if u_paid or u_before != u_after:
                    await self._broadcast_haul(relay)
                l_before = (self.light or {}).get("status")
                L.maybe_expire_light(self.light, self.now_ms())
                l_paid = await self._pay_light(relay)
                l_after = (self.light or {}).get("status")
                if l_paid or l_before != l_after:
                    await self._broadcast_light(relay)
                i_before = (self.hill or {}).get("status")
                L.maybe_expire_hill(self.hill, self.now_ms())
                i_paid = await self._pay_hill(relay)
                i_after = (self.hill or {}).get("status")
                if i_paid or i_before != i_after:
                    await self._broadcast_hill(relay)
                m_before = (self.smash or {}).get("status")
                L.maybe_expire_smash(self.smash, self.now_ms())
                m_paid = await self._pay_smash(relay)
                m_after = (self.smash or {}).get("status")
                if m_paid or m_before != m_after:
                    await self._broadcast_smash(relay)
                v_before = (self.vase or {}).get("status")
                L.maybe_expire_vase(self.vase, self.now_ms())
                v_paid = await self._pay_vase(relay)
                v_after = (self.vase or {}).get("status")
                if v_paid or v_before != v_after:
                    await self._broadcast_vase(relay)

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
                "likes": rec["social"]["likes"], "crops": len(rec["farm"]["crops"]), "debris": len(rec["farm"]["debris"]),
                "title": (rec.get("titles") or [""])[-1], "crowns": int((rec.get("arena") or {}).get("wins", 0)), "stamps": len(rec.get("stamps") or {})}

    def private_view(self, rec: dict[str, Any]) -> dict[str, Any]:
        s = rec["social"]
        return {"name": rec["name"], "farm": L.pack_farm(rec["farm"]), "inv": rec["inv"], "seeds": rec["seeds"], "seedSel": rec["seedSel"],
                "gold": rec["gold"], "shares": L.shares_of(rec), "decor": rec["decor"], "look": rec["look"], "pet": PT.state(rec)["on"],
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

    async def _progress(self, relay, uid: str, rec: dict[str, Any] | None, events: list[tuple[str, Any]]) -> list[dict[str, Any]]:
        """集章與每日委託的進度；新完成的項目推給本人（獎金已入帳）。"""
        if rec is None or not events:
            return []
        now = self.now_ms()
        done = Q.note(rec, uid, events, L.taipei_day(now), now)
        self.dirty.add(uid)
        if done:
            await self._push_me(relay, uid, quest=done)
        return done

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
        if L.regrow(rec["farm"], me, L.taipei_day(self.now_ms())):
            self.dirty.add(me)
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
                await self._progress(relay, me, rec, [("friends_best", len(s["friends"]))])
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
        bonus = 0
        if r["total"]:
            online = {str(c.user_id) for c in relay.connections if c.game_id == GAME_ID}
            friends = sum(1 for f in rec["social"]["friends"] if f["id"] in online and f["id"] != me)
            pct = min(30, 10 * friends)                     # 好友在線加成：每位 +10%，最多 +30%
            bonus = r["total"] * pct // 100
            rec["gold"] += bonus
            await self._progress(relay, me, rec, [("ship_gold", r["total"] + bonus)])
        return {"total": r["total"], "bonus": bonus, "sold": r["sold"], **self._mine(rec)}

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
        if L.regrow(orec["farm"], owner, L.taipei_day(self.now_ms())):
            self.dirty.add(owner)
        if owner != me:
            await self._progress(relay, me, rec, [(f"uniq:visit={owner}", 0)])
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
            ev: list[tuple[str, Any]] = []
            if owner == me:
                if r.get("harvest"):
                    ev += [("harvest", 1), (f"uniq:crop={r['harvest']}", 0)]
                if r.get("cleared"):
                    ev.append(("clear", 1))
            else:
                ev.append(("coop_help", 1))
                if r.get("water"):
                    ev.append(("water_other", 1))
            await self._progress(relay, me, rec, ev)
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
        await self._progress(relay, me, rec, [("like", 1)])
        await self._progress(relay, owner, orec, [("liked_best", orec["social"]["likes"])])
        return {"likes": orec["social"]["likes"]}

    async def op_gift(self, relay, conn, me, rec, p):
        to, trec = await self._owner(me, rec, p.get("to"))
        item = p.get("item")
        if to == me:
            raise GameError("bad_user")
        if not (item in L.CROPS or item in L.PIES or (isinstance(item, str) and item.startswith("fish_") and item in L.ITEMS)) or rec["inv"].get(item, 0) <= 0:
            raise GameError("no_item", "背包裡沒有這個東西")
        rec["inv"][item] -= 1
        if not rec["inv"][item]:
            del rec["inv"][item]
        self.dirty.add(me)
        await self._notify(relay, to, me, rec["name"], "sysgift", {"item": item, "n": 1})
        await self._progress(relay, me, rec, [("gift", 1)])
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
        elif kind in ("syssold", "sysdiv", "sysbuild", "sysrank"):
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
        await self._progress(relay, me, rec, [("buy", 1)])
        await self._progress(relay, listing["seller"], seller, [("sell", 1)])
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
        if where not in ("sea", "pond", "pier"):
            raise GameError("bad_message")
        if where == "pier" and not TW.built(self.town, "pier"):
            raise GameError("not_built", "碼頭還沒蓋好")
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
            fev: list[tuple[str, Any]] = [("fish", 1), (f"fish:{fish['id']}", 1), (f"uniq:fish={fish['id']}", 0)]
            if fish["id"] in ("octopus", "shrimp"):
                fev.append((f"uniq:pierfish={fish['id']}", 0))
            await self._progress(relay, me, rec, fev)
            L.note_act(self.ex, "FISH", 1)
            self.ex_dirty = True
            self.dirty.add(me)
        L.maybe_expire_contest(self.contest, now)
        await self._pay_contest(relay)
        if cast["contest"] and not fish.get("junk"):
            r = L.contest_catch(self.contest, me, rec["name"], fish["id"], size, now)
            if r.get("round") is not None:
                self.contest = r["round"]
            if r.get("ok"):
                await self._broadcast_contest(relay)
        view = L.contest_view(self.contest, me, now)
        return {
            "fish": fish["id"], "caught": True, "size": size, "contest": cast["contest"],
            "board": view, "payout": view.get("payout") or 0, **self._mine(rec),
        }

    # ---------- 地標：菲比女神噴水池、瑞吉海獅秀 ----------
    async def op_wish(self, relay, conn, me, rec, p):
        day = L.taipei_day(self.now_ms())
        ws = rec.get("wishes") if isinstance(rec.get("wishes"), dict) else {}
        if ws.get("day") != day:
            ws = {"day": day, "n": 0}
        if ws["n"] >= WISH_DAILY:
            raise GameError("wish_limit", f"女神今天已經聽了你 {WISH_DAILY} 個願望，明天再來")
        if rec["gold"] < WISH_COST:
            raise GameError("no_gold", f"許願要投 {WISH_COST} G")
        ws["n"] += 1
        rec["wishes"] = ws
        rec["gold"] -= WISH_COST
        r = self.rng.random()
        if r < 0.02:
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
        await self._progress(relay, me, rec, [("wish", 1)])
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
        await self._progress(relay, me, rec, [("feed", 1)])
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

    async def _pay_party(self, relay) -> dict[str, int]:
        rnd = self.party
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_party_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "party", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _party_progress(self, relay, kind: str, uid: str, rec: dict[str, Any], n: int) -> None:
        day = L.taipei_day(self.now_ms())
        pp = rec.get("partyPay") if isinstance(rec.get("partyPay"), dict) else {}
        if pp.get("day") != day:
            pp = {"day": day, "n": 0}
        if pp["n"] >= PARTY_DAILY_PAID:                 # 今天的獎金場次用完：退回這一場的金幣
            rec["gold"] -= n
            if pp["n"] == PARTY_DAILY_PAID:
                pp["n"] += 1
                await self._push_me(relay, uid, partyCap=PARTY_DAILY_PAID)
        else:
            pp["n"] += 1
            if n and self._spotlight(self.now_ms()) == kind:   # 焦點派對獎金 ×1.5
                extra = int(n * PB.SPOTLIGHT_BONUS)
                rec["gold"] += extra
                await self._push_me(relay, uid, spotlightBonus=extra)
        rec["partyPay"] = pp
        ev: list[tuple[str, Any]] = [("party_play", 1), (f"uniq:party={kind}", 0)]
        if n >= 40:                                   # 第一名（或贏的隊伍）拿 40 G
            ev.append(("party_win", 1))
        await self._progress(relay, uid, rec, ev)

    async def _broadcast_party(self, relay) -> None:
        view = L.party_public(self.party, self.now_ms())
        payload = {"type": "game", "op": "party", "party": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def _pay_contest(self, relay) -> dict[str, int]:
        rnd = self.contest
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_contest_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                if n >= 10:
                    await self._progress(relay, uid, rec, [("contest_top3", 1)])
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_contest(self, relay) -> None:
        view = L.contest_public(self.contest, self.now_ms())
        payload = {"type": "game", "op": "contest", "contest": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_contest(self, relay, conn, me, rec, p):
        now = self.now_ms()
        L.maybe_expire_contest(self.contest, now)
        paid = await self._pay_contest(relay)
        if paid:
            await self._broadcast_contest(relay)
        view = L.contest_view(self.contest, me, now)
        return {"contest": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def _pay_seek(self, relay) -> dict[str, int]:
        rnd = self.seek
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_seek_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "seek", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_seek(self, relay) -> None:
        view = L.seek_public(self.seek, self.now_ms())
        payload = {"type": "game", "op": "seek", "seek": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_seek(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "hide", "check", "leave", "view"):
            raise GameError("bad_message", "無效的捉迷藏動作")
        now = self.now_ms()
        L.maybe_expire_seek(self.seek, now)
        await self._pay_seek(relay)
        rnd = self.seek
        if act == "join":
            r = L.seek_join(rnd, me, rec["name"], now)
        elif act == "hide":
            r = L.seek_hide(rnd, me, p.get("spot"), p.get("x"), p.get("y"), now)
        elif act == "check":
            r = L.seek_check(rnd, me, p.get("spot"), p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.seek_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.seek = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_seek(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_seek(relay)
        await self._broadcast_seek(relay)
        view = L.seek_view(self.seek, me, now)
        return {"seek": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def _pay_hot(self, relay) -> dict[str, int]:
        rnd = self.hot
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_hot_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "hot", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_hot(self, relay) -> None:
        view = L.hot_public(self.hot, self.now_ms())
        payload = {"type": "game", "op": "hot", "hot": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_hot(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "take", "leave", "view"):
            raise GameError("bad_message", "無效的傳南瓜動作")
        now = self.now_ms()
        L.maybe_expire_hot(self.hot, now)
        await self._pay_hot(relay)
        rnd = self.hot
        if act == "join":
            r = L.hot_join(rnd, me, rec["name"], now)
        elif act == "take":
            r = L.hot_take(rnd, me, p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.hot_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.hot = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_hot(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_hot(relay)
        await self._broadcast_hot(relay)
        view = L.hot_view(self.hot, me, now)
        return {"hot": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def _pay_tug(self, relay) -> dict[str, int]:
        rnd = self.tug
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_tug_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "tug", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_tug(self, relay) -> None:
        view = L.tug_public(self.tug, self.now_ms())
        payload = {"type": "game", "op": "tug", "tug": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_tug(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "pull", "leave", "view"):
            raise GameError("bad_message", "無效的拔河動作")
        now = self.now_ms()
        L.maybe_expire_tug(self.tug, now)
        await self._pay_tug(relay)
        rnd = self.tug
        if act == "join":
            r = L.tug_join(rnd, me, rec["name"], now)
        elif act == "pull":
            r = L.tug_pull(rnd, me, p.get("side"), p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.tug_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.tug = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_tug(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_tug(relay)
        await self._broadcast_tug(relay)
        view = L.tug_view(self.tug, me, now)
        return {"tug": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def _pay_haul(self, relay) -> dict[str, int]:
        rnd = self.haul
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_haul_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "haul", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_haul(self, relay) -> None:
        view = L.haul_public(self.haul, self.now_ms())
        payload = {"type": "game", "op": "haul", "haul": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_haul(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "take", "drop", "leave", "view"):
            raise GameError("bad_message", "無效的搬寶動作")
        now = self.now_ms()
        L.maybe_expire_haul(self.haul, now)
        await self._pay_haul(relay)
        rnd = self.haul
        if act == "join":
            r = L.haul_join(rnd, me, rec["name"], now)
        elif act == "take":
            r = L.haul_take(rnd, me, p.get("x"), p.get("y"), now)
        elif act == "drop":
            r = L.haul_drop(rnd, me, p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.haul_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.haul = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_haul(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_haul(relay)
        await self._broadcast_haul(relay)
        view = L.haul_view(self.haul, me, now)
        return {"haul": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def _pay_light(self, relay) -> dict[str, int]:
        rnd = self.light
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_light_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "light", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_light(self, relay) -> None:
        view = L.light_public(self.light, self.now_ms())
        payload = {"type": "game", "op": "light", "light": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_light(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "dash", "leave", "view"):
            raise GameError("bad_message", "無效的紅綠燈動作")
        now = self.now_ms()
        L.maybe_expire_light(self.light, now)
        await self._pay_light(relay)
        rnd = self.light
        if act == "join":
            r = L.light_join(rnd, me, rec["name"], now)
        elif act == "dash":
            r = L.light_dash(rnd, me, p.get("spot"), p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.light_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.light = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_light(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_light(relay)
        await self._broadcast_light(relay)
        view = L.light_view(self.light, me, now)
        return {"light": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def _pay_hill(self, relay) -> dict[str, int]:
        rnd = self.hill
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_hill_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "hill", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_hill(self, relay) -> None:
        view = L.hill_public(self.hill, self.now_ms())
        payload = {"type": "game", "op": "hill", "hill": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_hill(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "take", "leave", "view"):
            raise GameError("bad_message", "無效的占席動作")
        now = self.now_ms()
        L.maybe_expire_hill(self.hill, now)
        await self._pay_hill(relay)
        rnd = self.hill
        if act == "join":
            r = L.hill_join(rnd, me, rec["name"], now)
        elif act == "take":
            r = L.hill_take(rnd, me, p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.hill_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.hill = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_hill(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_hill(relay)
        await self._broadcast_hill(relay)
        view = L.hill_view(self.hill, me, now)
        return {"hill": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def _pay_smash(self, relay) -> dict[str, int]:
        rnd = self.smash
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_smash_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "smash", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_smash(self, relay) -> None:
        view = L.smash_public(self.smash, self.now_ms())
        payload = {"type": "game", "op": "smash", "smash": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_smash(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "hit", "leave", "view"):
            raise GameError("bad_message", "無效的砸罐動作")
        now = self.now_ms()
        L.maybe_expire_smash(self.smash, now)
        await self._pay_smash(relay)
        rnd = self.smash
        if act == "join":
            r = L.smash_join(rnd, me, rec["name"], now)
        elif act == "hit":
            r = L.smash_hit(rnd, me, p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.smash_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.smash = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_smash(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_smash(relay)
        await self._broadcast_smash(relay)
        view = L.smash_view(self.smash, me, now)
        return {"smash": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def _pay_vase(self, relay) -> dict[str, int]:
        rnd = self.vase
        paid: dict[str, int] = {}
        if not rnd or rnd.get("status") != "over":
            return paid
        for uid in rnd.get("order") or []:
            if str(uid).startswith("npc:"):
                continue
            rec = self.players.get(uid)
            if rec is None:
                continue
            n = L.apply_vase_gold(rec, uid, rnd)
            if n:
                self.dirty.add(uid)
                paid[uid] = n
                await self._party_progress(relay, "vase", uid, rec, n)
                await self._push_me(relay, uid)
        return paid

    async def _broadcast_vase(self, relay) -> None:
        view = L.vase_public(self.vase, self.now_ms())
        payload = {"type": "game", "op": "vase", "vase": view}
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def op_vase(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "take", "leave", "view"):
            raise GameError("bad_message", "無效的搶瓶動作")
        now = self.now_ms()
        L.maybe_expire_vase(self.vase, now)
        await self._pay_vase(relay)
        rnd = self.vase
        if act == "join":
            r = L.vase_join(rnd, me, rec["name"], now)
        elif act == "take":
            r = L.vase_take(rnd, me, p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.vase_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.vase = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_vase(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_vase(relay)
        await self._broadcast_vase(relay)
        view = L.vase_view(self.vase, me, now)
        return {"vase": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    async def op_party(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act not in ("join", "grab", "leave", "view"):
            raise GameError("bad_message", "無效的搶寶動作")
        now = self.now_ms()
        L.maybe_expire_party(self.party, now)
        await self._pay_party(relay)
        rnd = self.party
        if act == "join":
            r = L.party_join(rnd, me, rec["name"], now)
        elif act == "grab":
            r = L.party_grab(rnd, me, p.get("spot"), p.get("x"), p.get("y"), now)
        elif act == "leave":
            r = L.party_leave(rnd, me, now)
        else:
            r = {"ok": True, "round": rnd}
        if "round" in r and r["round"] is not None:
            self.party = r["round"]
        if act != "view" and not r.get("ok"):
            await self._broadcast_party(relay)
            raise GameError(r["code"], r.get("msg") or r["code"])
        await self._pay_party(relay)
        await self._broadcast_party(relay)
        view = L.party_view(self.party, me, now)
        return {"party": view, "payout": view.get("payout") or 0, **self._mine(rec)}

    # ---------- 派派大作戰（派對競技場） ----------
    def on_pose(self, conn, data: dict[str, Any]) -> None:
        """relay 轉來的位置訊息：記住所在區域；在競技場的人交給模擬。"""
        a = data.get("a")
        conn.area = a if isinstance(a, str) and len(a) <= 48 else None
        pos = data.get("p")
        if conn.area == "arena" and isinstance(pos, list) and len(pos) == 2:
            self.arena.pose(str(conn.user_id), pos[0], pos[1], self.now_ms())
        elif conn.area == "plaza" and self.boss.active and isinstance(pos, list) and len(pos) == 2:
            self.boss.pose(str(conn.user_id), conn.display_name or conn.username, pos[0], pos[1], self.now_ms())

    def _arena_conns(self, relay) -> list:
        return [c for c in list(relay.connections) if c.game_id == GAME_ID and c.area == "arena"]

    async def _arena_loop(self, relay) -> None:
        last_err = 0.0
        while True:
            await asyncio.sleep(ARENA_SECONDS)
            try:
                await self._arena_step(relay)
            except asyncio.CancelledError:
                raise
            except Exception:                      # 不讓一次錯誤停掉即時遊戲；每分鐘最多記一次
                if self.clock() - last_err > 60:
                    last_err = self.clock()
                    log.exception("arena/boss/party-bots step failed")

    async def _party_bots(self, relay) -> None:
        """九個廣場派對：等太久就讓鎮民來湊人數，開場後鎮民照規則行動。"""
        now = self.now_ms()
        online = None
        for kind in PB.KINDS:
            rnd = getattr(self, kind)
            if not rnd:
                continue
            changed = False
            humans = PB.humans(rnd)
            if rnd.get("status") == "open" and humans:
                if online is None:
                    online = {str(c.user_id) for c in relay.connections if c.game_id == GAME_ID}
                crowd = bool(online - set(humans))
                key = (id(rnd), humans[0])
                if self._party_called.get(kind) != key:      # 有人開始等：全鎮廣播，大家可以一鍵過來
                    self._party_called[kind] = key
                    rec0 = self.players.get(humans[0]) or {}
                    call = {"type": "game", "op": "partyCall", "kind": kind, "name": rec0.get("name") or "鎮民", "n": len(rnd["order"]),
                            "wait": PB.FILL_MS_CROWD if crowd else PB.FILL_MS, "now": now}
                    for c in list(relay.connections):
                        if c.game_id == GAME_ID and str(c.user_id) not in humans:
                            await self._send(c, call)
                since = self._bot_wait.setdefault(kind, now)
                if now - since >= (PB.FILL_MS_CROWD if crowd else PB.FILL_MS):
                    rnd = PB.fill(kind, rnd, now)
                    setattr(self, kind, rnd)
                    self._bot_wait.pop(kind, None)
                    changed = True
            else:
                self._bot_wait.pop(kind, None)
            if rnd.get("status") == "live" and PB.humans(rnd):
                for b in [u for u in rnd.get("order") or [] if PB.is_bot(u)]:
                    key = (kind, b)
                    if now < self._bot_next.get(key, 0):
                        continue
                    self._bot_next[key] = now + self.rng.randint(*PB.STEP_MS)
                    if PB.act(kind, rnd, b, now, self.rng, self._bot_memo.setdefault(key, {})):
                        changed = True
            elif rnd.get("status") != "live":
                for key in [k for k in self._bot_next if k[0] == kind]:
                    self._bot_next.pop(key, None)
                    self._bot_memo.pop(key, None)
            if changed:
                await getattr(self, f"_broadcast_{kind}")(relay)

    async def _fireworks_step(self, relay, now: int) -> None:
        """煙火台蓋好後：每晚 21:00–21:05（台北）在廣場的人，每天一次小禮物。"""
        if not TW.built(self.town, "fireworks"):
            return
        t = L.taipei(now)
        if not (t.tm_hour == 21 and t.tm_min < 5):
            return
        day = L.taipei_day(now)
        for c in list(relay.connections):
            if c.game_id != GAME_ID or c.area != "plaza":
                continue
            uid = str(c.user_id)
            rec = self.players.get(uid)
            if rec is None or rec.get("fw") == day:
                continue
            rec["fw"] = day
            rec["gold"] += 20
            crop = self.rng.choice(L.CROP_KEYS)
            rec["seeds"][crop] = rec["seeds"].get(crop, 0) + 2
            self.dirty.add(uid)
            await self._push_me(relay, uid, fwGift={"gold": 20, "item": crop, "n": 2})

    async def _boss_step(self, relay, now: int, dt: float) -> None:
        """大胃王蛙：排程出現、預告、模擬、推播、發獎。"""
        bs = self.boss
        start, until = BS.window(now)
        if not bs.active and start <= now < until and self._boss_started != start:
            self._boss_started = start
            humans = len({str(c.user_id) for c in relay.connections if c.game_id == GAME_ID and c.area == "plaza"})
            bs.start(now, until, humans)
            await self._game_all(relay, {"type": "game", "op": "bossCall", "k": "arrive", "at": start, "until": until, "now": now})
        nxt = BS.next_start(now)
        if not bs.active and nxt - BS.WARN_MS <= now < nxt and self._boss_warned != nxt:
            self._boss_warned = nxt
            await self._game_all(relay, {"type": "game", "op": "bossCall", "k": "warn", "at": nxt, "now": now})
        if not bs.active and not bs.events:
            return
        if bs.active:
            here = {str(c.user_id) for c in relay.connections if c.game_id == GAME_ID and c.area == "plaza"}
            for uid in [u for u, pl in bs.p.items() if not pl["bot"] and u not in here and now - pl["seen"] > 3000]:
                bs.leave(uid)
            bs.tick(now, dt)
        if bs.reward_due is not None:
            due, bs.reward_due = bs.reward_due, None
            await self._boss_pay(relay, due)
        snap = bs.snapshot(now)
        bs.take_events()
        payload = {"type": "game", "op": "boss", "boss": snap}
        for c in list(relay.connections):
            if c.game_id == GAME_ID and c.area == "plaza":
                await self._send(c, payload)

    async def _game_all(self, relay, payload: dict[str, Any]) -> None:
        for c in list(relay.connections):
            if c.game_id == GAME_ID:
                await self._send(c, payload)

    async def _boss_pay(self, relay, due: list[dict[str, Any]]) -> None:
        day = L.taipei_day(self.now_ms())
        for r in due:
            rec = await self.load(r["id"], create=False)
            if rec is None:
                continue
            st = rec.setdefault("boss", {"day": "", "n": 0, "fed": 0})
            if st.get("day") != day:
                st["day"], st["n"] = day, 0
            gift = None
            gold = r["gold"] if st["n"] < BS.DAILY_REWARDS else 0
            if gold:
                st["n"] += 1
                rec["gold"] += gold
                if r["full"]:
                    crop = self.rng.choice(L.CROP_KEYS)
                    rec["seeds"][crop] = rec["seeds"].get(crop, 0) + 3
                    gift = {"item": crop, "n": 3}
            if r["full"]:
                st["fed"] = st.get("fed", 0) + 1
            self.dirty.add(r["id"])
            await self._push_me(relay, r["id"], bossGold=gold, bossGift=gift, bossFull=r["full"], bossHits=r["hits"])
            ev: list[tuple[str, Any]] = [("boss_hit", r["hits"])]
            if r["full"] and r["hits"] >= 1:
                ev.append(("boss_feed", 1))
            if r.get("top"):
                ev.append(("boss_top", 1))
            await self._progress(relay, r["id"], rec, ev)
            if r["hits"] >= 1:
                await self._party_rain(relay, r["id"], rec)

    async def op_boss(self, relay, conn, me, rec, p):
        act = p.get("act")
        now = self.now_ms()
        if act == "throw":
            if conn.area != "plaza":
                raise GameError("too_far", "要在廣場才能丟")
            err = self.boss.throw(me, rec["name"], p.get("dx"), p.get("dy"), now)
            if err:
                raise GameError(err, {"no_ammo": "派餅補充中", "stunned": "被震暈了", "not_live": "大胃王蛙不在", "too_far": "先走進廣場"}.get(err, err))
            return {"ammo": self.boss.ammo_of(me)}
        if act != "view":
            raise GameError("bad_message", "無效的動作")
        st = rec.get("boss") or {}
        left = BS.DAILY_REWARDS - (st.get("n", 0) if st.get("day") == L.taipei_day(now) else 0)
        return {"boss": self.boss.snapshot(now), "next": BS.next_start(now), "rewardsLeft": max(0, left), "fedTotal": st.get("fed", 0)}

    async def _arena_step(self, relay) -> None:
        ar, now = self.arena, self.now_ms()
        if now - self._bots_at >= 400:
            self._bots_at = now
            await self._party_bots(relay)
        if now // 1000 != self._fw_sec:
            self._fw_sec = now // 1000
            await self._fireworks_step(relay, now)
            await self._weekly_step(relay, now)
        await self._boss_step(relay, now, min(0.25, max(0.0, (now - self._arena_last) / 1000)) if self._arena_last else ARENA_SECONDS)
        dt = min(0.25, max(0.0, (now - self._arena_last) / 1000)) if self._arena_last else ARENA_SECONDS
        self._arena_last = now
        if ar.phase != "idle":
            # 斷線或離開競技場超過 4 秒：退出
            if now - self._arena_seen > 1000:
                self._arena_seen = now
                here = {str(c.user_id) for c in self._arena_conns(relay)}
                for uid in list(ar.queue if ar.phase == "queue" else ar.humans()):
                    pl = ar.p.get(uid)
                    if pl and uid not in here and now - (pl["seen"] or 0) > 4000:
                        ar.leave(uid, now)
        before = ar.phase
        ar.tick(now, dt)
        if ar.payout_due:
            due, ar.payout_due = ar.payout_due, None
            await self._arena_pay(relay, due)
        if ar.phase != "queue":
            self._arena_called = False
        elif ar.queue and not self._arena_called:
            self._arena_called = True
            first = ar.p[ar.queue[0]]["name"]  # 全鎮廣播：有人報名了
            call = {"type": "game", "op": "arenaCall", "name": first, "end": ar.phase_end, "now": now}
            for c in list(relay.connections):
                if c.game_id == GAME_ID and c.area != "arena":
                    await self._send(c, call)
        if ar.running or ar.events or before != ar.phase:
            snap = ar.snapshot(now)
            ar.take_events()
            payload = {"type": "game", "op": "arena", "arena": snap}
            for c in self._arena_conns(relay):
                await self._send(c, payload)

    async def _party_rain(self, relay, uid: str, rec: dict[str, Any]) -> None:
        """打完派派大作戰或餵蛙：家裡下了一場及時雨，作物都澆好水了。"""
        changed = L.rain(rec["farm"], self.now_ms())
        if changed:
            self.dirty.add(uid)
            await self._broadcast_patch(relay, uid, changed, by=None, kind="rain")
            await self._push_me(relay, uid, rained=len(changed))

    async def _arena_pay(self, relay, due: list[dict[str, Any]]) -> None:
        day = L.taipei_day(self.now_ms())
        for r in due:
            rec = await self.load(r["id"], create=False)
            if rec is None:
                continue
            st = rec.setdefault("arena", {"day": "", "paid": 0, "shows": 0, "wins": 0, "best": 0})
            if st.get("day") != day:
                st["day"], st["paid"] = day, 0
            gold = int(r.get("gold") or 0) if st["paid"] < AR.DAILY_PAID else 0
            if gold and L.event_active("partynight", self.now_ms()):
                gold *= 2                                   # 派對之夜：獎金加倍
            if gold:
                st["paid"] += 1
                rec["gold"] += gold
            st["shows"] = st.get("shows", 0) + 1
            if r["rank"] == 1:
                st["wins"] = st.get("wins", 0) + 1
            st["best"] = max(st.get("best", 0), r["total"])
            r["gold"] = gold
            for res in self.arena.results or []:          # 頒獎畫面顯示實際入帳（含派對之夜、每日上限）
                if res["id"] == r["id"]:
                    res["gold"] = gold
            self.dirty.add(r["id"])
            await self._push_me(relay, r["id"], arenaGold=gold, arenaRank=r["rank"])
            stats = r.get("stats") or {}
            ev: list[tuple[str, Any]] = [("arena_play", 1), ("arena_coin_best", stats.get("coin", 0)), ("arena_hit_best", stats.get("hit", 0)),
                                         ("arena_quiz_best", stats.get("quiz", 0))]
            if r["rank"] == 1:
                ev.append(("arena_win", 1))
            if stats.get("survive"):
                ev.append(("arena_floor_survive", 1))
            if r.get("humans", 0) >= 3:
                ev.append(("arena_humans3", 1))
            await self._progress(relay, r["id"], rec, ev)
            await self._party_rain(relay, r["id"], rec)

    async def op_arena(self, relay, conn, me, rec, p):
        act = p.get("act")
        now = self.now_ms()
        ar = self.arena
        if act == "join":
            err = ar.join(me, rec["name"], rec.get("look"), p.get("x"), p.get("y"), now) if all(
                isinstance(p.get(k), (int, float)) for k in ("x", "y")) else "bad_message"
            if err:
                raise GameError(err, {"arena_busy": "比賽進行中，下一場再報名", "already_in": "你已經報名了", "too_far": "走近報名台再按 E",
                                      "arena_full": "這場人滿了", "bad_message": "位置不對"}.get(err, err))
            conn.area = "arena"
        elif act == "leave":
            ar.leave(me, now)
        elif act == "throw":
            err = ar.throw(me, p.get("dx"), p.get("dy"), now)
            if err:
                raise GameError(err, {"no_ammo": "派餅還沒補好", "stunned": "被派打中，暈了", "not_live": "現在不能丟"}.get(err, err))
            return {}
        elif act == "enter":
            conn.area = "arena"
        elif act != "view":
            raise GameError("bad_message", "無效的競技場動作")
        st = rec.get("arena") or {}
        day = L.taipei_day(now)
        return {"arena": ar.snapshot(now), "stats": {"shows": st.get("shows", 0), "wins": st.get("wins", 0),
                "paidLeft": AR.DAILY_PAID - (st.get("paid", 0) if st.get("day") == day else 0)}}

    # ---------- 全鎮工程（派派新區） ----------
    def _apply_town_effects(self) -> None:
        L.GROW_SPEED = 1.25 if TW.built(self.town, "greenhouse") else 1.0

    def _town_public(self) -> dict[str, Any]:
        return {"done": list(self.town["done"]), "cur": self.town["cur"], "p": round(TW.progress(self.town), 3)}

    async def op_town(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act == "donate":
            item = p.get("item")
            n = self._int(p.get("n"), 1, 99999)
            if not isinstance(item, str) or not (item == "gold" or item in L.ITEMS):
                raise GameError("bad_message", "沒有這種東西")
            r = TW.donate(self.town, rec, me, rec["name"], item, n, L.SELL, self.now_ms())
            if not r["ok"]:
                raise GameError(r["code"], r["msg"])
            self.town_dirty = True
            self.dirty.add(me)
            await self._progress(relay, me, rec, [("town_give", 1), ("town_points", r["points"])])
            if r.get("done"):
                await self._town_finished(relay, r["done"])
            pub = self._town_public()
            for c in list(relay.connections):
                if c.game_id == GAME_ID and c.area == "frontier" and c is not conn:
                    await self._send(c, {"type": "game", "op": "town", "town": pub, "by": rec["name"], "key": r["key"], "n": r["took"]})
            return {"took": r["took"], "points": r["points"], "done": r.get("done"), "view": TW.view(self.town, me), "town": pub, **self._mine(rec)}
        if act != "view":
            raise GameError("bad_message", "無效的動作")
        return {"view": TW.view(self.town, me), "town": self._town_public(), "grow": L.GROW_SPEED}

    async def _town_finished(self, relay, done: dict[str, Any]) -> None:
        self._apply_town_effects()
        self.town_dirty = True
        for r in done["rewards"]:
            try:                                          # 一個人出錯不影響其他人的回饋金
                rec = await self.load(r["id"], create=False)
                if rec is None:
                    continue
                rec["gold"] += r["gold"]
                self.dirty.add(r["id"])
                ev: list[tuple[str, Any]] = [("town_build", 1)]
                if r["top"]:
                    ev.append(("town_top", 1))
                await self._progress(relay, r["id"], rec, ev)
                await self._push_me(relay, r["id"])
                await self._notify(relay, r["id"], "sys", "建設委員會", "sysbuild", {"name": done["name"], "gold": r["gold"], "points": r["points"]})
            except Exception:
                log.exception("town reward failed for %s", r["id"])
        await self._game_all(relay, {"type": "game", "op": "townDone", "name": done["name"], "effect": done["effect"], "town": self._town_public(),
                                     "top": done["rewards"][0]["name"] if done["rewards"] else ""})

    # ---------- 烘焙與鎮民好感 ----------
    async def op_bake(self, relay, conn, me, rec, p):
        pie = p.get("pie")
        n = self._int(p.get("n"), 1, 99)
        recipe = L.PIES.get(pie) if isinstance(pie, str) else None
        if recipe is None:
            raise GameError("bad_pie", "沒有這種派")
        can = min(rec["inv"].get(k, 0) // v for k, v in recipe["need"].items())
        if can <= 0:
            raise GameError("no_item", "材料不夠")
        n = min(n, can)
        for k, v in recipe["need"].items():
            rec["inv"][k] -= v * n
            if not rec["inv"][k]:
                del rec["inv"][k]
        rec["inv"][pie] = rec["inv"].get(pie, 0) + n
        self.dirty.add(me)
        await self._progress(relay, me, rec, [("bake", n), (f"uniq:pie={pie}", 0)])
        return {"baked": n, "pie": pie, **self._mine(rec)}

    async def op_npc(self, relay, conn, me, rec, p):
        day = L.taipei_day(self.now_ms())
        if p.get("act") == "gift":
            r = FR.gift(rec, p.get("npc"), p.get("item"), day, L.ITEMS)
            if not r["ok"]:
                raise GameError(r["code"], r["msg"])
            self.dirty.add(me)
            best, five = FR.counts(rec)
            await self._progress(relay, me, rec, [("npc_gift", 1), ("npc_best", best), ("npc_five", five)])
            return {**r, "friends": FR.view(rec, day), **self._mine(rec)}
        return {"friends": FR.view(rec, day)}

    async def op_hunt(self, relay, conn, me, rec, p):
        day = L.taipei_day(self.now_ms())
        act = p.get("act")
        if act == "find":
            r = HU.find(rec, day, p.get("id"), p.get("x"), p.get("y"))
            if not r["ok"]:
                raise GameError(r["code"], r["msg"])
            self.dirty.add(me)
            ev: list[tuple[str, Any]] = [("hunt_find", 1)]
            if r["all"]:
                ev.append(("hunt_all", 1))
            await self._progress(relay, me, rec, ev)
            return {**r, "hunt": HU.view(rec, day), **self._mine(rec)}
        if act != "view":
            raise GameError("bad_message", "無效的動作")
        return {"hunt": HU.view(rec, day)}

    async def op_pets(self, relay, conn, me, rec, p):
        act = p.get("act")
        if act == "adopt":
            r = PT.adopt(rec, p.get("pet"))
        elif act == "choose":
            r = PT.choose(rec, p.get("pet"))
        elif act == "view":
            r = {"ok": True}
        else:
            raise GameError("bad_message", "無效的動作")
        if not r["ok"]:
            raise GameError(r["code"], r["msg"])
        if act != "view":
            self.dirty.add(me)
        if act == "adopt":
            await self._progress(relay, me, rec, [("pets_best", len(PT.state(rec)["own"]))])
        return {"pets": PT.view(rec), **self._mine(rec)}

    # ---------- 週榜 ----------
    def _week_rows(self, wk: str) -> list[tuple[str, str, dict[str, Any]]]:
        with self.store._lock:
            rows = self.store._db.execute(
                "SELECT user_id, name, json_extract(data, '$.week'), json_extract(data, '$.week_prev') FROM plaza_players "
                "WHERE json_extract(data, '$.week.wk') = ? OR json_extract(data, '$.week_prev.wk') = ?", (wk, wk)).fetchall()
        out = []
        for uid, name, w, prev in rows:
            for blob in (w, prev):
                d = json.loads(blob) if blob else None
                if isinstance(d, dict) and d.get("wk") == wk:
                    out.append((uid, name, d))
                    break
        return out

    def _boards(self, rows: list[tuple[str, str, dict[str, Any]]], n: int) -> dict[str, list[list[Any]]]:
        out = {}
        for key, _title in Q.WEEK_BOARDS:
            ranked = sorted(((name, int(d.get(key, 0)), uid) for uid, name, d in rows if int(d.get(key, 0)) > 0), key=lambda r: -r[1])
            out[key] = [[name, v, uid] for name, v, uid in ranked[:n]]
        return out

    async def op_rank(self, relay, conn, me, rec, p):
        now = self.now_ms()
        wk = Q.week_of(L.taipei_day(now))
        if not self._rank_cache or now - self._rank_cache[0] > 30_000 or self._rank_cache[1] != wk:
            await self.flush()
            rows = await asyncio.to_thread(self._week_rows, wk)
            self._rank_cache = (now, wk, self._boards(rows, 10))
        boards = self._rank_cache[2]
        mine = rec.get("week") if (rec.get("week") or {}).get("wk") == wk else {}
        return {"week": wk, "boards": [{"key": k, "title": t, "top": [[n, v] for n, v, _ in boards[k]], "mine": int((mine or {}).get(k, 0))}
                                       for k, t in Q.WEEK_BOARDS],
                "gold": Q.WEEK_GOLD, "last": self.weekly.get("champs") or []}

    async def _weekly_step(self, relay, now: int) -> None:
        """每分鐘看一次：換週了就結算上週，前三名發金幣與系統信。"""
        if now - self._week_check < 60_000:
            return
        self._week_check = now
        wk = Q.week_of(L.taipei_day(now))
        last = self.weekly.get("last")
        if last == wk:
            return
        boards: dict[str, list[list[Any]]] = {}
        if last:
            await self.flush()
            rows = await asyncio.to_thread(self._week_rows, last)
            boards = self._boards(rows, 3)
        # 先記「已結算」再發獎：就算發到一半當機，重啟也不會重複發
        self.weekly = {"last": wk, "champs": [[title, boards[key][0][0]] for key, title in Q.WEEK_BOARDS if boards.get(key)]}
        await asyncio.to_thread(self._write_kv, "weekly", json.dumps(self.weekly, ensure_ascii=False))
        for key, title in Q.WEEK_BOARDS:
            for i, (name, v, uid) in enumerate(boards.get(key) or []):
                try:
                    gold = Q.WEEK_GOLD[i]
                    rec = await self.load(uid, create=False)
                    if rec is None:
                        continue
                    rec["gold"] += gold
                    self.dirty.add(uid)
                    if i == 0:
                        await self._progress(relay, uid, rec, [("week_champ", 1)])
                    await self._push_me(relay, uid)
                    await self._notify(relay, uid, "sys", "派派鎮公所", "sysrank", {"title": title, "rank": i + 1, "gold": gold, "week": last, "v": v})
                except Exception:
                    log.exception("weekly reward failed for %s", uid)

    def _write_kv(self, k: str, v: str) -> None:
        with self.store._lock:
            self.store._db.execute("INSERT INTO plaza_exchange (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))

    async def op_quests(self, relay, conn, me, rec, p):
        return {"quests": Q.view(rec, me, L.taipei_day(self.now_ms()))}

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
        await self._progress(relay, me, rec, [("trade", 1)])
        return {**r, **L.quote_view(self.ex, rec, self.now_ms()), **self._mine(rec)}
