"""投稿遊戲的雲端存檔與信箱。

存檔：每個 (遊戲, 使用者, 鍵) 一份 JSON。擁有者可以把某個鍵設成公開，同一款遊戲的其他玩家
就能讀（拜訪家園用）；沒公開的一律只有自己讀得到。
信箱：同一款遊戲的玩家互相寄小型訊息（留言、按讚、禮物）。寄件人的 id 與名稱由伺服器填入，
不能偽造；每個收件匣只留最新的 MAX_INBOX 封。

身分來自多人 WebSocket 已驗證的連線（一次性通行證兌換），所以這裡不處理登入。
資料放在 SQLite（WAL 模式），所有資料庫操作都丟到執行緒，不擋住事件迴圈。
"""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

KEY_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
USER_RE = re.compile(r"^[A-Za-z0-9_.@:-]{1,64}$")
KIND_RE = re.compile(r"^[a-z]{1,12}$")
MAX_VALUE_BYTES = 48 * 1024
MAX_KEYS_PER_USER = 16
MAX_LIST_VALUE_BYTES = 4 * 1024      # 名冊只列小型的公開值（名片），避免一次回傳太多
MAX_LIST = 50
MAX_MAIL_BYTES = 1024
MAX_INBOX = 100

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS saves (
        game_id    TEXT    NOT NULL,
        user_id    TEXT    NOT NULL,
        key        TEXT    NOT NULL,
        value      TEXT    NOT NULL,
        rev        INTEGER NOT NULL,
        updated_at REAL    NOT NULL,
        public     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, user_id, key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS inbox (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id    TEXT    NOT NULL,
        to_user    TEXT    NOT NULL,
        from_user  TEXT    NOT NULL,
        from_name  TEXT    NOT NULL,
        kind       TEXT    NOT NULL,
        data       TEXT    NOT NULL,
        created_at REAL    NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS inbox_to ON inbox (game_id, to_user, id)",
    "CREATE INDEX IF NOT EXISTS saves_public ON saves (game_id, key, public, updated_at)",
)


class SaveError(Exception):
    """可回給用戶端的錯誤（code 會原樣送出）。"""

    def __init__(self, code: str, current: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.current = current


class SaveStore:
    def __init__(self, path: str | Path, *, clock=time.time) -> None:
        self.path = Path(path)
        self.clock = clock
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        tables, indexes = [x for x in SCHEMA if "INDEX" not in x], [x for x in SCHEMA if "INDEX" in x]
        for statement in tables:
            self._db.execute(statement)
        columns = {row[1] for row in self._db.execute("PRAGMA table_info(saves)")}
        if "public" not in columns:      # 第一版資料庫沒有 public 欄：先補欄位再建索引
            self._db.execute("ALTER TABLE saves ADD COLUMN public INTEGER NOT NULL DEFAULT 0")
        for statement in indexes:
            self._db.execute(statement)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ---------- 存檔 ----------
    def get_sync(self, game_id: str, user_id: str, key: str) -> dict[str, Any] | None:
        _check_key(key)
        with self._lock:
            row = self._db.execute(
                "SELECT value, rev, updated_at, public FROM saves WHERE game_id=? AND user_id=? AND key=?",
                (game_id, str(user_id), key),
            ).fetchone()
        if row is None:
            return None
        return {"value": json.loads(row[0]), "rev": row[1], "updatedAt": row[2], "public": bool(row[3])}

    def peek_sync(self, game_id: str, owner: str, key: str) -> dict[str, Any] | None:
        """讀別人的存檔：只有公開的才回傳，否則當成不存在。"""
        _check_key(key)
        _check_user(owner)
        with self._lock:
            row = self._db.execute(
                "SELECT value, updated_at FROM saves WHERE game_id=? AND user_id=? AND key=? AND public=1",
                (game_id, owner, key),
            ).fetchone()
        return None if row is None else {"value": json.loads(row[0]), "updatedAt": row[1]}

    def list_public_sync(self, game_id: str, key: str) -> list[dict[str, Any]]:
        """某個鍵所有公開的小型值（例如名片），新的在前。"""
        _check_key(key)
        with self._lock:
            rows = self._db.execute(
                "SELECT user_id, value, updated_at FROM saves WHERE game_id=? AND key=? AND public=1 "
                "AND length(value) <= ? ORDER BY updated_at DESC LIMIT ?",
                (game_id, key, MAX_LIST_VALUE_BYTES, MAX_LIST),
            ).fetchall()
        return [{"user": r[0], "value": json.loads(r[1]), "updatedAt": r[2]} for r in rows]

    def put_sync(self, game_id: str, user_id: str, key: str, value: Any, if_rev: int | None = None,
                 public: bool = False) -> dict[str, Any]:
        _check_key(key)
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(text.encode("utf-8")) > MAX_VALUE_BYTES:
            raise SaveError("save_too_large")
        uid, now = str(user_id), self.clock()
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                row = self._db.execute(
                    "SELECT value, rev, updated_at FROM saves WHERE game_id=? AND user_id=? AND key=?",
                    (game_id, uid, key),
                ).fetchone()
                if row is None:
                    count = self._db.execute(
                        "SELECT COUNT(*) FROM saves WHERE game_id=? AND user_id=?", (game_id, uid)
                    ).fetchone()[0]
                    if count >= MAX_KEYS_PER_USER:
                        raise SaveError("save_too_many_keys")
                current_rev = row[1] if row else 0
                # if_rev：用戶端以為的目前版本；不一樣代表別的裝置先存過，交給用戶端合併
                if if_rev is not None and if_rev != current_rev:
                    raise SaveError(
                        "save_conflict",
                        {"value": json.loads(row[0]), "rev": row[1], "updatedAt": row[2]} if row else None,
                    )
                rev = current_rev + 1
                self._db.execute(
                    "INSERT INTO saves (game_id, user_id, key, value, rev, updated_at, public) VALUES (?,?,?,?,?,?,?) "
                    "ON CONFLICT(game_id, user_id, key) DO UPDATE SET value=excluded.value, rev=excluded.rev, "
                    "updated_at=excluded.updated_at, public=excluded.public",
                    (game_id, uid, key, text, rev, now, 1 if public else 0),
                )
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return {"rev": rev, "updatedAt": now}

    # ---------- 信箱 ----------
    def mail_send_sync(self, game_id: str, from_user: str, from_name: str, to_user: str, kind: str, data: Any) -> dict[str, Any]:
        _check_user(to_user)
        if not isinstance(kind, str) or not KIND_RE.match(kind):
            raise SaveError("bad_mail")
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(text.encode("utf-8")) > MAX_MAIL_BYTES:
            raise SaveError("mail_too_large")
        now = self.clock()
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                cur = self._db.execute(
                    "INSERT INTO inbox (game_id, to_user, from_user, from_name, kind, data, created_at) VALUES (?,?,?,?,?,?,?)",
                    (game_id, to_user, str(from_user), str(from_name)[:40], kind, text, now),
                )
                # 只留最新的 MAX_INBOX 封
                self._db.execute(
                    "DELETE FROM inbox WHERE game_id=? AND to_user=? AND id NOT IN "
                    "(SELECT id FROM inbox WHERE game_id=? AND to_user=? ORDER BY id DESC LIMIT ?)",
                    (game_id, to_user, game_id, to_user, MAX_INBOX),
                )
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return {"id": cur.lastrowid, "createdAt": now}

    def mail_list_sync(self, game_id: str, user_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, from_user, from_name, kind, data, created_at FROM inbox WHERE game_id=? AND to_user=? ORDER BY id DESC LIMIT ?",
                (game_id, str(user_id), MAX_INBOX),
            ).fetchall()
        return [{"id": r[0], "from": r[1], "fromName": r[2], "kind": r[3], "data": json.loads(r[4]), "createdAt": r[5]} for r in rows]

    def mail_delete_sync(self, game_id: str, user_id: str, ids: list[int]) -> int:
        """刪自己收件匣的信（別人的刪不到）。回傳刪掉幾封。"""
        clean = [i for i in ids if isinstance(i, int) and not isinstance(i, bool)][:MAX_INBOX]
        if not clean:
            return 0
        with self._lock:
            cur = self._db.execute(
                f"DELETE FROM inbox WHERE game_id=? AND to_user=? AND id IN ({','.join('?' * len(clean))})",
                (game_id, str(user_id), *clean),
            )
        return cur.rowcount

    def mail_take_sync(self, game_id: str, user_id: str, mail_id: int) -> tuple[str, Any] | None:
        """取走自己的一封信（讀完立刻刪除，同一封只會成功一次）。回傳 (kind, data) 或 None。"""
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                row = self._db.execute("SELECT kind, data FROM inbox WHERE id=? AND game_id=? AND to_user=?",
                                       (mail_id, game_id, str(user_id))).fetchone()
                if row:
                    self._db.execute("DELETE FROM inbox WHERE id=?", (mail_id,))
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return (row[0], json.loads(row[1])) if row else None

    # ---------- 非同步包裝 ----------
    async def get(self, game_id: str, user_id: str, key: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self.get_sync, game_id, user_id, key)

    async def put(self, game_id: str, user_id: str, key: str, value: Any, if_rev: int | None = None,
                  public: bool = False) -> dict[str, Any]:
        return await asyncio.to_thread(self.put_sync, game_id, user_id, key, value, if_rev, public)

    async def peek(self, game_id: str, owner: str, key: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self.peek_sync, game_id, owner, key)

    async def list_public(self, game_id: str, key: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.list_public_sync, game_id, key)

    async def mail_send(self, *args: Any) -> dict[str, Any]:
        return await asyncio.to_thread(self.mail_send_sync, *args)

    async def mail_list(self, game_id: str, user_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.mail_list_sync, game_id, user_id)

    async def mail_delete(self, game_id: str, user_id: str, ids: list[int]) -> int:
        return await asyncio.to_thread(self.mail_delete_sync, game_id, user_id, ids)


def _check_key(key: Any) -> None:
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise SaveError("bad_save_key")


def _check_user(user: Any) -> None:
    if not isinstance(user, str) or not USER_RE.match(user):
        raise SaveError("bad_user")
