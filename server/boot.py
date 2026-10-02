"""外框首頁的組裝：建置雜湊、模組預載、內嵌開機資料。

目標是讓瀏覽器從開頁到遊戲可玩只等「HTML＋一次跨站 API」：

- 外框靜態檔改走 `/s/<build>/…`，build 是 shell 目錄內容的雜湊。ES module 的相對 import
  會自動帶著同一個前綴，所以整個模組圖都能 immutable 快取（Cloudflare 邊緣＋瀏覽器），
  不會再有新舊模組混用的問題。
- 首頁一次列出整個靜態模組圖的 modulepreload，瀏覽器不必一層一層發現 import。
- 投稿目錄（index.json＋各 game.json）與 retire-count 的金幣遊戲清單直接內嵌在 HTML，
  省掉開機時兩次跨站請求。
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

import aiohttp

LOGGER = logging.getLogger(__name__)

GAME_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}$")
RELEASE_RE = re.compile(r"^[0-9a-f]{7,64}$")
BUILD_RE = re.compile(r"^[0-9a-f]{12}$")
_MAX_JSON_BYTES = 64 * 1024

# 只認相對路徑的靜態 import／export-from；動態 import() 不在這裡（官方遊戲是點進去才載）。
_STATIC_IMPORT_RE = re.compile(
    r"""^\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"](\.{1,2}/[^'"]+)['"]""",
    re.MULTILINE,
)
_LOCAL_REF_RE = re.compile(r"""(\s(?:href|src))="\./([^"]+)\"""")


def _shell_files(shell_root: Path) -> list[Path]:
    files = []
    for path in sorted(shell_root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(shell_root)
        if relative.parts and relative.parts[0] == "tests":
            continue
        files.append(path)
    return files


def build_id(shell_root: Path) -> str:
    """shell 目錄內容的雜湊（12 碼）。內容一樣就一樣，任何檔案改了就換。"""
    digest = hashlib.sha256()
    for path in _shell_files(shell_root):
        digest.update(path.relative_to(shell_root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:12]


def module_graph(shell_root: Path, entries: list[str]) -> list[str]:
    """從 entries 出發走靜態 import，回傳 shell 根目錄下的相對路徑（含 entries，依發現順序）。"""
    root = shell_root.resolve()
    seen: list[str] = []
    stack = list(entries)
    while stack:
        relative = stack.pop(0)
        if relative in seen:
            continue
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
            source = path.read_text(encoding="utf-8")
        except (OSError, ValueError, UnicodeDecodeError):
            continue
        seen.append(relative)
        for specifier in _STATIC_IMPORT_RE.findall(source):
            target = (path.parent / specifier).resolve()
            try:
                stack.append(target.relative_to(root).as_posix())
            except ValueError:
                continue
    return seen


def preload_modules(shell_root: Path) -> list[str]:
    """首頁要 modulepreload 的模組：外框本體的模組圖，加上六款官方遊戲共用的相依。

    官方遊戲的 game.js 本身不預載（只有點進去才需要），但 _bridge／cards／icons 很小，
    先載好之後點進遊戲只剩一層請求。
    """
    modules = module_graph(shell_root, ["shell.js"])
    official = sorted(
        path.relative_to(shell_root).as_posix()
        for path in shell_root.glob("official/*/game.js")
    )
    for relative in module_graph(shell_root, official):
        if relative not in official and relative not in modules:
            modules.append(relative)
    return modules


def release_token(root: Path | None) -> str | None:
    """live 目前指向的 release sha；不是 releases/<sha>/site 結構（例如開發模式）就回 None。"""
    if root is None:
        return None
    release_dir = root.parent
    if release_dir.parent.name != "releases" or not RELEASE_RE.match(release_dir.name):
        return None
    return release_dir.name


def _read_json(path: Path) -> Any:
    try:
        with path.open("rb") as handle:
            raw = handle.read(_MAX_JSON_BYTES + 1)
    except OSError:
        return None
    if len(raw) > _MAX_JSON_BYTES:
        return None
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, ValueError):
        return None


def read_catalog(root: Path) -> list[dict[str, Any]]:
    """跟外框原本在瀏覽器做的事一樣：讀 index.json，再讀每個 game.json，id 不符就丟掉。"""
    community = root / "games" / "community"
    index = _read_json(community / "index.json")
    items = index.get("games") if isinstance(index, dict) else None
    if not isinstance(items, list):
        return []
    games: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        game_id = item if isinstance(item, str) else (item.get("id") if isinstance(item, dict) else None)
        if not isinstance(game_id, str) or not GAME_ID_RE.match(game_id) or game_id in seen:
            continue
        seen.add(game_id)
        game_path = community / game_id / "game.json"
        try:
            game_path.resolve(strict=True).relative_to(community.resolve())
        except (OSError, RuntimeError, ValueError):
            continue
        meta = _read_json(game_path)
        if isinstance(meta, dict) and meta.get("id") == game_id:
            games.append(meta)
    return games


class CatalogCache:
    """投稿目錄快取。live 切換會換 realpath，所以用 realpath＋index.json 的 mtime 當 key。"""

    def __init__(self, *, always_reload: bool = False) -> None:
        self._always_reload = always_reload
        self._key: tuple[str, int] | None = None
        self._games: list[dict[str, Any]] = []

    def get(self, root: Path | None) -> list[dict[str, Any]] | None:
        if root is None:
            return None
        try:
            mtime = (root / "games" / "community" / "index.json").stat().st_mtime_ns
        except OSError:
            mtime = -1
        key = (str(root), mtime)
        if self._always_reload or key != self._key:
            self._games = read_catalog(root)
            self._key = key
        return self._games


Fetcher = Callable[[], Awaitable[dict[str, Any] | None]]


def retire_community_fetcher(retire_base: str) -> Fetcher:
    """從本機 retire-count 拿金幣遊戲清單（跟瀏覽器打 /api/casino/community 同一份全域快照）。"""

    async def fetch() -> dict[str, Any] | None:
        timeout = aiohttp.ClientTimeout(total=2)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(f"{retire_base}/api/casino/community") as response:
                if response.status != 200:
                    return None
                payload = await response.json(content_type=None)
        if not isinstance(payload, dict) or not isinstance(payload.get("games"), list):
            return None
        return payload

    return fetch


class CasinoListCache:
    """金幣遊戲清單的記憶體快取：過期先回舊值、背景更新，首頁永遠不會被 retire-count 卡住。

    retire-count 每 10 分鐘才重抓一次規格，15 秒的 TTL 已經夠新；真正下注時伺服器會再驗一次。
    """

    def __init__(self, fetch: Fetcher, *, ttl: float = 15.0, first_wait: float = 0.3) -> None:
        self._fetch = fetch
        self._ttl = ttl
        self._first_wait = first_wait
        self._value: dict[str, Any] | None = None
        self._fetched_at = 0.0
        self._task: asyncio.Task[None] | None = None

    async def _refresh(self) -> None:
        try:
            value = await self._fetch()
        except Exception as error:  # noqa: BLE001 - 任何失敗都只是退回瀏覽器自己抓
            LOGGER.warning("casino list refresh failed: %s", error)
            value = None
        if value is not None:
            self._value = value
            self._fetched_at = time.monotonic()

    def _ensure_refresh(self) -> asyncio.Task[None]:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._refresh())
        return self._task

    async def get(self) -> dict[str, Any] | None:
        fresh = self._value is not None and time.monotonic() - self._fetched_at < self._ttl
        if fresh:
            return self._value
        task = self._ensure_refresh()
        if self._value is None:
            # 還沒有任何資料：最多等一小段，等不到就讓瀏覽器自己抓。
            try:
                await asyncio.wait_for(asyncio.shield(task), self._first_wait)
            except (asyncio.TimeoutError, Exception):  # noqa: BLE001
                pass
        return self._value

    async def close(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass


def _json_for_html(value: Any) -> str:
    """可以安全放進 <script type="application/json"> 的 JSON（投稿內容不受信任）。"""
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return (
        text.replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def early_hints(build: str, preconnect: list[str]) -> str:
    """首頁的 Link 標頭：只放一定用得到、而且不會過期出錯的東西（連線＋外框入口）。"""
    prefix = f"/s/{build}/"
    links = [f"<{origin}>; rel=preconnect" for origin in preconnect]
    links += [
        f"<{prefix}tokens.css>; rel=preload; as=style",
        f"<{prefix}shell.css>; rel=preload; as=style",
        f"<{prefix}shell.js>; rel=modulepreload",
    ]
    return ", ".join(links)


def render_index(
    template: str,
    *,
    build: str,
    modules: list[str],
    preconnect: list[str],
    preload_fetch: list[str],
    boot: dict[str, Any],
) -> str:
    """把原始 index.html 的 ./ 資源改成 /s/<build>/，並在 </head> 前補預載與開機資料。

    原始檔維持可直接用靜態伺服器打開（e2e 測試就是這樣跑），所有加工都在這裡做。
    """
    prefix = f"/s/{build}/"
    body = _LOCAL_REF_RE.sub(lambda m: f'{m.group(1)}="{prefix}{m.group(2)}"', template)
    if "</head>" not in body:
        return body
    lines = []
    for origin in preconnect:
        safe = html.escape(origin, quote=True)
        # 帶 cookie 的 fetch 與 iframe 走「有憑證」連線池，credentials:'omit' 走匿名池，兩個都暖。
        lines.append(f'<link rel="preconnect" href="{safe}">')
        lines.append(f'<link rel="preconnect" href="{safe}" crossorigin>')
    for url in preload_fetch:
        lines.append(
            f'<link rel="preload" as="fetch" crossorigin="use-credentials" href="{html.escape(url, quote=True)}">'
        )
    for module in modules:
        lines.append(f'<link rel="modulepreload" href="{prefix}{html.escape(module, quote=True)}">')
    lines.append(f'<script type="application/json" id="pg-boot">{_json_for_html(boot)}</script>')
    injected = "\n  ".join(lines)
    return body.replace("</head>", f"  {injected}\n</head>", 1)
