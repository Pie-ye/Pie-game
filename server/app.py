"""aiohttp entry point for the Pie-game shell and content origins."""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path
from stat import S_ISREG
from typing import Any
from urllib.parse import unquote, urlsplit, urlunsplit

from aiohttp import web

from . import __version__
from . import boot
from .relay import Relay

DEFAULT_SHELL_PORT = 54460
DEFAULT_CONTENT_PORT = 54461
DEV_SHELL_PORT = 54470
DEV_CONTENT_PORT = 54471
# 主機把整個 ~/pie-game-content 唯讀掛進來，live 是指向 releases/<sha> 的相對符號連結。
DEFAULT_CONTENT_DIR = "/srv/pie-content/live/site"


@dataclass(frozen=True, slots=True)
class Settings:
    shell_port: int
    content_port: int
    bind: str
    shell_origin: str
    content_origin: str
    api_origin: str
    retire_base: str
    site_dir: Path
    content_dir: Path
    dev: bool = False

    @classmethod
    def from_env(cls, *, dev: bool = False) -> "Settings":
        shell_default = DEV_SHELL_PORT if dev else DEFAULT_SHELL_PORT
        content_default = DEV_CONTENT_PORT if dev else DEFAULT_CONTENT_PORT
        shell_port = _env_port("PG_SHELL_PORT", shell_default)
        content_port = _env_port("PG_CONTENT_PORT", content_default)
        repository_root = Path(__file__).resolve().parents[1]

        if dev:
            site_dir = repository_root / "site"
            content_dir = repository_root / "site"
            # 開發預設是本機；要從 Tailscale 內的其他裝置預覽時用環境變數指到 tailnet 位址。
            shell_origin = os.environ.get("PG_SHELL_ORIGIN", f"http://localhost:{shell_port}")
            content_origin = os.environ.get("PG_CONTENT_ORIGIN", f"http://127.0.0.1:{content_port}")
        else:
            site_dir = Path(os.environ.get("PG_SITE_DIR", "/app/site"))
            content_dir = Path(os.environ.get("PG_CONTENT_DIR", DEFAULT_CONTENT_DIR))
            shell_origin = os.environ.get("PG_SHELL_ORIGIN", "https://game.coinpilet.win")
            content_origin = os.environ.get("PG_CONTENT_ORIGIN", "https://play.piea.uk")

        return cls(
            shell_port=shell_port,
            content_port=content_port,
            bind=os.environ.get("PG_BIND", "127.0.0.1"),
            shell_origin=shell_origin.rstrip("/"),
            content_origin=content_origin.rstrip("/"),
            api_origin=os.environ.get("PG_API_ORIGIN", "https://coinpilet.win").rstrip("/"),
            retire_base=os.environ.get("PG_RETIRE_BASE", "http://127.0.0.1:54432").rstrip("/"),
            site_dir=site_dir,
            content_dir=content_dir,
            dev=dev,
        )


def shell_csp(settings: Settings) -> str:
    return "; ".join(
        (
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            f"connect-src 'self' {settings.api_origin} {settings.content_origin}",
            f"frame-src {settings.content_origin}",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        )
    )


def content_csp(settings: Settings) -> str:
    return "; ".join(
        (
            "default-src 'self' blob: data:",
            "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob:",
            "style-src 'self' 'unsafe-inline'",
            "worker-src 'self' blob:",
            f"connect-src 'self' {_websocket_origin(settings.content_origin)}",
            f"frame-ancestors {settings.shell_origin}",
            "base-uri 'self'",
        )
    )


def content_root(settings: Settings) -> Path | None:
    """當下解析出的 live 內容根目錄；`live` 連結不存在時回 None。

    `content_dir` 走的是會被同步腳本原子切換的 `live` 符號連結，所以每個請求都要
    重新解析：啟動時快取 realpath 會讓切換後的新內容永遠進不到容器裡。
    """
    try:
        resolved = settings.content_dir.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    return resolved if resolved.is_dir() else None


def _require_content_root(settings: Settings) -> Path:
    root = content_root(settings)
    if root is None:
        raise web.HTTPServiceUnavailable(
            text=json.dumps({"error": "content_unavailable"}),
            content_type="application/json",
        )
    return root


def _healthz_payload(settings: Settings) -> dict[str, Any]:
    return {
        "ok": True,
        "version": __version__,
        "content": content_root(settings) is not None,
    }


_IMMUTABLE = "public, max-age=31536000, immutable"
# 開機就要打的跨站 API：首頁直接 preload，瀏覽器解析 HTML 時就發出去，跟模組載入同時跑。
_BOOT_API_PATHS = ("/api/casino/session",)


def create_shell_app(
    settings: Settings,
    *,
    casino_fetch: boot.Fetcher | None = None,
) -> web.Application:
    app = web.Application()
    _add_security_headers(app, shell_csp(settings))
    shell_root = settings.site_dir / "shell"
    catalog_cache = boot.CatalogCache(always_reload=settings.dev)
    casino_cache = boot.CasinoListCache(casino_fetch or boot.retire_community_fetcher(settings.retire_base))
    # 正式環境 shell 目錄是映像裡的唯讀檔，啟動時算一次；開發模式每次首頁重算，改檔立即生效。
    frozen: dict[str, Any] = {}

    def shell_build() -> tuple[str, list[str]]:
        if settings.dev or not frozen:
            frozen["build"] = boot.build_id(shell_root) if shell_root.is_dir() else "0" * 12
            frozen["modules"] = boot.preload_modules(shell_root) if shell_root.is_dir() else []
        return frozen["build"], frozen["modules"]

    async def healthz(_: web.Request) -> web.Response:
        return web.json_response(_healthz_payload(settings))

    async def index(request: web.Request) -> web.StreamResponse:
        try:
            template = (shell_root / "index.html").read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            raise web.HTTPNotFound() from None
        build, modules = shell_build()
        root = content_root(settings)
        boot_data: dict[str, Any] = {
            "build": build,
            "release": boot.release_token(root),
            "games": catalog_cache.get(root),
            "casino": await casino_cache.get(),
        }
        preconnect = [settings.content_origin]
        preload_fetch: list[str] = []
        if not settings.dev:
            # 開發模式的 API origin 可能被 ?api= 改掉，不預載免得打錯地方。
            preconnect.insert(0, settings.api_origin)
            preload_fetch = [f"{settings.api_origin}{path}" for path in _BOOT_API_PATHS]
        body = boot.render_index(
            template,
            build=build,
            modules=modules,
            preconnect=preconnect,
            preload_fetch=preload_fetch,
            boot=boot_data,
        )
        headers = {"Cache-Control": "no-store"}
        if not settings.dev:
            # Cloudflare 開了 Early Hints 時會拿這個標頭先送 103，HTML 還在回源的路上瀏覽器就開始連線、抓模組。
            headers["Link"] = boot.early_hints(build, preconnect)
        return web.Response(text=body, content_type="text/html", charset="utf-8", headers=headers)

    async def versioned(request: web.Request) -> web.StreamResponse:
        requested_build = request.match_info["build"]
        relative = request.match_info.get("path", "")
        # 首頁只能從 / 拿（要即時組開機資料），版本前綴下不給原始樣板。
        if relative in ("", "index.html") or relative.endswith("/"):
            raise web.HTTPNotFound()
        response = await _static_response(request, shell_root, relative)
        current, _ = shell_build()
        # 舊 HTML 指到已經換掉的 build 時照樣給現在的檔案（同一個前綴下彼此一致），但不能快取。
        response.headers["Cache-Control"] = _IMMUTABLE if requested_build == current else "no-store"
        return response

    async def static(request: web.Request) -> web.StreamResponse:
        relative = request.match_info.get("path", "")
        if relative in ("", "index.html"):
            return await index(request)
        return await _static_response(request, shell_root, relative)

    async def casino_context(_: web.Application):
        yield
        await casino_cache.close()

    app.cleanup_ctx.append(casino_context)
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/", index)
    app.router.add_get(r"/s/{build:[0-9a-f]{12}}/{path:.*}", versioned)
    app.router.add_get("/{path:.*}", static)
    return app


def create_content_app(settings: Settings, *, relay: Relay | None = None) -> web.Application:
    app = web.Application()
    _add_security_headers(app, content_csp(settings))

    relay_service = relay or Relay(settings.content_origin, retire_base=settings.retire_base)
    app[RELAY_KEY] = relay_service

    async def healthz(_: web.Request) -> web.Response:
        return web.json_response(_healthz_payload(settings))

    async def sdk_static(request: web.Request) -> web.StreamResponse:
        relative = request.match_info.get("path", "")
        return await _static_response(request, _require_content_root(settings) / "sdk", relative)

    async def community_static(request: web.Request) -> web.StreamResponse:
        relative = request.match_info.get("path", "")
        response = await _static_response(
            request,
            _require_content_root(settings) / "games" / "community",
            relative,
        )
        _allow_json_cors(request, response, relative, settings)
        return response

    async def release_static(request: web.Request) -> web.StreamResponse:
        """`/r/<sha>/sdk/…`、`/r/<sha>/games/community/…`：同一個 release 的內容永遠不變，可以永久快取。

        外框的 iframe 指到這裡，遊戲裡的相對路徑（main.js、../../../sdk/…）自動帶著同一個前綴。
        """
        token = request.match_info["release"]
        area = request.match_info["area"]
        relative = request.match_info.get("path", "")
        current = _require_content_root(settings)
        root, cacheable = _release_root(current, token)
        base = root / "sdk" if area == "sdk" else root / "games" / "community"
        response = await _static_response(request, base, relative)
        if area == "games/community":
            _allow_json_cors(request, response, relative, settings)
        response.headers["Cache-Control"] = _IMMUTABLE if cacheable else "no-store"
        return response

    async def relay_context(_: web.Application):
        await relay_service.start()
        try:
            yield
        finally:
            await relay_service.close()

    app.cleanup_ctx.append(relay_context)
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/mp", relay_service.websocket_handler)
    app.router.add_get("/sdk/{path:.*}", sdk_static)
    app.router.add_get("/games/community/{path:.*}", community_static)
    app.router.add_get(
        r"/r/{release:[0-9a-f]{7,64}}/{area:sdk|games/community}/{path:.*}",
        release_static,
    )
    return app


def _allow_json_cors(
    request: web.Request,
    response: web.StreamResponse,
    relative: str,
    settings: Settings,
) -> None:
    if request.method == "GET" and relative.lower().endswith(".json"):
        response.headers["Access-Control-Allow-Origin"] = settings.shell_origin


def _release_root(current: Path, token: str) -> tuple[Path, bool]:
    """回傳 (內容根目錄, 能不能永久快取)。

    token 是現在的 live：用現在的根目錄。token 是還留著的舊 release（保留 5 版）：用那一版，
    開著舊頁面的玩家不會載到新舊混合的檔案。已經被清掉的舊 release 退回現在的內容但不快取。
    """
    if boot.release_token(current) == token:
        return current, True
    releases = current.parent.parent
    if boot.release_token(current) is not None:
        candidate = releases / token / "site"
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(releases.resolve())
        except (OSError, RuntimeError, ValueError):
            return current, False
        if resolved.is_dir():
            return resolved, True
    return current, False


RELAY_KEY: web.AppKey[Relay] = web.AppKey("relay", Relay)


def _add_security_headers(app: web.Application, csp: str) -> None:
    async def set_headers(_: web.Request, response: web.StreamResponse) -> None:
        response.headers["Content-Security-Policy"] = csp
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"

    app.on_response_prepare.append(set_headers)


class _NegotiatedFileResponse(web.FileResponse):
    """已經挑好檔案的 FileResponse。

    aiohttp 自己的預壓縮檔查找是用子字串比對 Accept-Encoding，不尊重 `q=0`；
    `_select_representation` 已經挑定要送的那一份，所以這裡把內建協商關掉，
    壓縮協商整個流程只做一次。
    """

    def __init__(self, path: Path, *, encoding: str | None, **kwargs: Any) -> None:
        super().__init__(path, **kwargs)
        self._negotiated_encoding = encoding

    def _get_file_path_stat_encoding(
        self,
        _accept_encoding: str,
    ) -> tuple[Path | None, os.stat_result, str | None]:
        stat_result = self._path.stat()
        if not S_ISREG(stat_result.st_mode):
            return None, stat_result, None
        return self._path, stat_result, self._negotiated_encoding


_CODE_SUFFIXES = frozenset({".js", ".mjs", ".css", ".json", ".map"})


async def _static_response(request: web.Request, root: Path, relative: str) -> web.StreamResponse:
    requested = _resolve_file(root, relative, request.raw_path)
    representation, logical_path, encoding = _select_representation(
        root,
        requested,
        request.headers.get("Accept-Encoding", ""),
    )
    headers = {
        "Content-Type": _content_type(logical_path),
        # FileResponse 只在送出內容時才補這個標頭，416 會提前返回，所以先放進來。
        "Accept-Ranges": "bytes",
    }
    if logical_path.suffix.lower() in {".html", ".htm"}:
        headers["Cache-Control"] = "no-store"
    elif "v" in request.query:
        headers["Cache-Control"] = _IMMUTABLE
    elif logical_path.suffix.lower() in _CODE_SUFFIXES:
        # 沒帶版本號的程式與設定（外框的 ES module、投稿遊戲的 js/json）：新舊混用會壞，一律不快取。
        # 不能用 no-cache：Cloudflare 的 Browser Cache TTL 會把它改寫成 max-age=14400，
        # 瀏覽器就會拿四小時前的舊模組；no-store 它不會改。
        headers["Cache-Control"] = "no-store"
    else:
        # 圖片等其他資源：每次向源站驗證（ETag／Last-Modified），舊一點也不會壞。
        headers["Cache-Control"] = "no-cache"

    return _NegotiatedFileResponse(representation, encoding=encoding, headers=headers)


def _resolve_file(root: Path, relative: str, raw_path: str) -> Path:
    decoded_path = unquote(raw_path.partition("?")[0])
    if "\x00" in relative or "\\" in relative:
        raise web.HTTPNotFound()
    if any(part == ".." for part in decoded_path.replace("\\", "/").split("/")):
        raise web.HTTPNotFound()

    root_resolved = root.resolve()
    candidate = root.joinpath(*relative.split("/"))
    if candidate.is_dir():
        candidate = candidate / "index.html"
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root_resolved)
    except (FileNotFoundError, OSError, RuntimeError, ValueError):
        raise web.HTTPNotFound() from None
    if not resolved.is_file():
        raise web.HTTPNotFound()
    return resolved


def _select_representation(
    root: Path,
    requested: Path,
    accept_encoding: str,
) -> tuple[Path, Path, str | None]:
    """挑出要送的那一份檔案：(實際檔案, 用來判斷 MIME 的邏輯路徑, Content-Encoding)。"""
    suffix = requested.suffix.lower()
    if suffix in {".br", ".gz"}:
        logical = Path(str(requested)[: -len(suffix)])
        return requested, logical, "br" if suffix == ".br" else "gzip"

    accepted = _accepted_encodings(accept_encoding)
    for extension, encoding in ((".br", "br"), (".gz", "gzip")):
        if encoding not in accepted:
            continue
        candidate = Path(f"{requested}{extension}")
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(root.resolve())
        except (FileNotFoundError, OSError, RuntimeError, ValueError):
            continue
        if resolved.is_file():
            return resolved, requested, encoding
    return requested, requested, None


def _accepted_encodings(header: str) -> set[str]:
    quality: dict[str, float] = {}
    wildcard: float | None = None
    for item in header.split(","):
        parts = [part.strip() for part in item.split(";")]
        name = parts[0].lower()
        if not name:
            continue
        q = 1.0
        for parameter in parts[1:]:
            if parameter.lower().startswith("q="):
                try:
                    q = float(parameter[2:])
                except ValueError:
                    q = 0.0
        if name == "*":
            wildcard = q
        else:
            quality[name] = q
    return {
        encoding
        for encoding in ("br", "gzip")
        if quality.get(encoding, wildcard if wildcard is not None else 0.0) > 0
    }


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".wasm":
        return "application/wasm"
    if suffix in {".pck", ".data", ".unityweb"}:
        return "application/octet-stream"
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def _websocket_origin(origin: str) -> str:
    parsed = urlsplit(origin)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunsplit((scheme, parsed.netloc, "", "", ""))


def _env_port(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        port = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if not 1 <= port <= 65535:
        raise ValueError(f"{name} must be between 1 and 65535")
    return port


async def serve(settings: Settings) -> None:
    shell_runner = web.AppRunner(create_shell_app(settings))
    content_runner = web.AppRunner(create_content_app(settings))
    await shell_runner.setup()
    await content_runner.setup()
    shell_site = web.TCPSite(shell_runner, settings.bind, settings.shell_port)
    content_site = web.TCPSite(content_runner, settings.bind, settings.content_port)
    try:
        await shell_site.start()
        await content_site.start()
        await asyncio.Event().wait()
    finally:
        await content_runner.cleanup()
        await shell_runner.cleanup()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Pie-game service")
    parser.add_argument("--dev", action="store_true", help="use repository content and local origins")
    arguments = parser.parse_args()
    try:
        asyncio.run(serve(Settings.from_env(dev=arguments.dev)))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
