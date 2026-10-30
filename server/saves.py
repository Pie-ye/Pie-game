"""投稿遊戲的雲端存檔：每個 (遊戲, 使用者, 鍵) 一份 JSON。

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
MAX_VALUE_BYTES = 48 * 1024
MAX_KEYS_PER_USER = 16

SCHEMA = """
CREATE TABLE IF NOT EXISTS saves (
    game_id    TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    key        TEXT    NOT NULL,
    value      TEXT    NOT NULL,
    rev        INTEGER NOT NULL,
    updated_at REAL    NOT NULL,
    PRIMARY KEY (game_id, user_id, key)
)
"""


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
        self._db.execute(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ---------- 同步版本（在執行緒裡跑） ----------
    def get_sync(self, game_id: str, user_id: str, key: str) -> dict[str, Any] | None:
        _check_key(key)
        with self._lock:
            row = self._db.execute(
                "SELECT value, rev, updated_at FROM saves WHERE game_id=? AND user_id=? AND key=?",
                (game_id, str(user_id), key),
            ).fetchone()
        if row is None:
            return None
        return {"value": json.loads(row[0]), "rev": row[1], "updatedAt": row[2]}

    def put_sync(self, game_id: str, user_id: str, key: str, value: Any, if_rev: int | None = None) -> dict[str, Any]:
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
                    "INSERT INTO saves (game_id, user_id, key, value, rev, updated_at) VALUES (?,?,?,?,?,?) "
                    "ON CONFLICT(game_id, user_id, key) DO UPDATE SET value=excluded.value, rev=excluded.rev, "
                    "updated_at=excluded.updated_at",
                    (game_id, uid, key, text, rev, now),
                )
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return {"rev": rev, "updatedAt": now}

    # ---------- 非同步包裝 ----------
    async def get(self, game_id: str, user_id: str, key: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self.get_sync, game_id, user_id, key)

    async def put(self, game_id: str, user_id: str, key: str, value: Any, if_rev: int | None = None) -> dict[str, Any]:
        return await asyncio.to_thread(self.put_sync, game_id, user_id, key, value, if_rev)


def _check_key(key: Any) -> None:
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise SaveError("bad_save_key")
