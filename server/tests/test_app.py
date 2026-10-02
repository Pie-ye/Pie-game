from __future__ import annotations

import gzip
from dataclasses import replace
from pathlib import Path

import pytest
from yarl import URL

from server import __version__
from server import relay as relay_module
from server.app import Settings, create_content_app, create_shell_app
from server.relay import Relay


async def _unused_redeem(_: str):
    raise ValueError("not used")


@pytest.mark.asyncio
async def test_shell_headers_cache_and_health(aiohttp_client, service_settings) -> None:
    shell = service_settings.site_dir / "shell"
    (shell / "index.html").write_text("<h1>建置中</h1>", encoding="utf-8")
    (shell / "app.js").write_text("export {};", encoding="utf-8")
    client = await aiohttp_client(create_shell_app(service_settings))

    response = await client.get("/")
    assert response.status == 200
    assert await response.text() == "<h1>建置中</h1>"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "same-origin"
    assert response.headers["Content-Security-Policy"].split("; ") == [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self' https://coinpilet.win http://127.0.0.1:54471",
        "frame-src http://127.0.0.1:54471",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]

    versioned = await client.get("/app.js?v=abc123")
    assert versioned.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    health = await client.get("/healthz")
    assert health.status == 200
    assert (await health.json())["ok"] is True
    assert (await health.json())["version"]

    missing = await client.get("/missing")
    assert missing.status == 404
    assert "frame-ancestors 'none'" in missing.headers["Content-Security-Policy"]


@pytest.mark.asyncio
async def test_content_headers_routes_and_json_cors(aiohttp_client, service_settings) -> None:
    community = service_settings.content_dir / "games" / "community"
    (community / "index.json").write_text('{"games":[]}', encoding="utf-8")
    (community / "readme.txt").write_text("hello", encoding="utf-8")
    relay = Relay(service_settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(service_settings, relay=relay))

    root = await client.get("/")
    assert root.status == 404
    assert root.headers["Content-Security-Policy"].split("; ") == [
        "default-src 'self' blob: data:",
        "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob:",
        "style-src 'self' 'unsafe-inline'",
        "worker-src 'self' blob:",
        "connect-src 'self' ws://127.0.0.1:54471",
        "frame-ancestors http://localhost:54470",
        "base-uri 'self'",
    ]
    assert root.headers["X-Content-Type-Options"] == "nosniff"
    assert root.headers["Referrer-Policy"] == "same-origin"

    manifest = await client.get("/games/community/index.json")
    assert manifest.status == 200
    assert manifest.headers["Access-Control-Allow-Origin"] == service_settings.shell_origin

    text = await client.get("/games/community/readme.txt")
    assert text.status == 200
    assert "Access-Control-Allow-Origin" not in text.headers

    unknown = await client.get("/somewhere")
    assert unknown.status == 404


@pytest.mark.asyncio
async def test_static_path_traversal_and_symlink_escape(aiohttp_client, service_settings, tmp_path) -> None:
    community = service_settings.content_dir / "games" / "community"
    (community / "safe.txt").write_text("safe", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    (community / "escape.txt").symlink_to(outside)
    relay = Relay(service_settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(service_settings, relay=relay))

    traversal = URL("/games/community/%2e%2e/%2e%2e/outside.txt", encoded=True)
    assert (await client.get(traversal)).status == 404
    assert (await client.get("/games/community/escape.txt")).status == 404
    assert (await client.get("/games/community/safe.txt")).status == 200


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filename", "content_type"),
    [
        ("engine.wasm", "application/wasm"),
        ("game.pck", "application/octet-stream"),
        ("game.data", "application/octet-stream"),
        ("game.unityweb", "application/octet-stream"),
    ],
)
async def test_content_mime_types(
    aiohttp_client,
    service_settings,
    filename: str,
    content_type: str,
) -> None:
    community = service_settings.content_dir / "games" / "community"
    (community / filename).write_bytes(b"asset")
    relay = Relay(service_settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(service_settings, relay=relay))

    response = await client.get(f"/games/community/{filename}")
    assert response.status == 200
    assert response.headers["Content-Type"] == content_type


@pytest.mark.asyncio
async def test_range_requests(aiohttp_client, service_settings) -> None:
    community = service_settings.content_dir / "games" / "community"
    (community / "asset.bin").write_bytes(b"0123456789")
    relay = Relay(service_settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(service_settings, relay=relay))

    response = await client.get(
        "/games/community/asset.bin",
        headers={"Range": "bytes=2-5", "Accept-Encoding": "identity"},
    )
    assert response.status == 206
    assert response.headers["Accept-Ranges"] == "bytes"
    assert response.headers["Content-Range"] == "bytes 2-5/10"
    assert await response.read() == b"2345"

    suffix = await client.get(
        "/games/community/asset.bin",
        headers={"Range": "bytes=-3", "Accept-Encoding": "identity"},
    )
    assert suffix.status == 206
    assert await suffix.read() == b"789"

    invalid = await client.get(
        "/games/community/asset.bin",
        headers={"Range": "bytes=20-30", "Accept-Encoding": "identity"},
    )
    assert invalid.status == 416
    assert invalid.headers["Content-Range"] == "bytes */10"


@pytest.mark.asyncio
async def test_large_file_streaming_and_range(aiohttp_client, service_settings) -> None:
    community = service_settings.content_dir / "games" / "community"
    size = 2 * 1024 * 1024
    (community / "large.data").write_bytes(b"x" * size + b"TAIL")
    relay = Relay(service_settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(service_settings, relay=relay))

    full = await client.get(
        "/games/community/large.data",
        headers={"Accept-Encoding": "identity"},
    )
    assert full.status == 200
    assert full.headers["Content-Length"] == str(size + 4)
    received = 0
    async for chunk in full.content.iter_chunked(64 * 1024):
        received += len(chunk)
    assert received == size + 4

    tail = await client.get(
        "/games/community/large.data",
        headers={"Range": f"bytes={size}-", "Accept-Encoding": "identity"},
    )
    assert tail.status == 206
    assert tail.headers["Content-Range"] == f"bytes {size}-{size + 3}/{size + 4}"
    assert await tail.read() == b"TAIL"


@pytest.mark.asyncio
async def test_precompressed_gzip_and_brotli_headers(aiohttp_client, service_settings) -> None:
    community = service_settings.content_dir / "games" / "community"
    source = b"console.log('compressed');"
    (community / "bundle.js").write_bytes(source)
    (community / "bundle.js.gz").write_bytes(gzip.compress(source))
    (community / "engine.wasm.br").write_bytes(b"brotli-placeholder")
    relay = Relay(service_settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(service_settings, relay=relay))

    gzip_response = await client.get(
        "/games/community/bundle.js",
        headers={"Accept-Encoding": "gzip"},
    )
    assert gzip_response.status == 200
    assert gzip_response.headers["Content-Encoding"] == "gzip"
    assert gzip_response.headers["Vary"] == "Accept-Encoding"
    assert gzip_response.headers["Content-Type"] in {"text/javascript", "application/javascript"}
    assert await gzip_response.read() == source

    brotli_response = await client.head("/games/community/engine.wasm.br")
    assert brotli_response.status == 200
    assert brotli_response.headers["Content-Encoding"] == "br"
    assert brotli_response.headers["Content-Type"] == "application/wasm"


@pytest.mark.asyncio
async def test_identity_only_accept_encoding_skips_precompressed(
    aiohttp_client,
    service_settings,
) -> None:
    community = service_settings.content_dir / "games" / "community"
    source = b"console.log('plain');"
    (community / "bundle.js").write_bytes(source)
    (community / "bundle.js.gz").write_bytes(gzip.compress(b"compressed"))
    relay = Relay(service_settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(service_settings, relay=relay))

    refused = await client.get(
        "/games/community/bundle.js",
        headers={"Accept-Encoding": "gzip;q=0, br;q=0"},
        auto_decompress=False,
    )
    assert refused.status == 200
    assert "Content-Encoding" not in refused.headers
    assert await refused.read() == source


@pytest.mark.asyncio
async def test_unsatisfiable_range_advertises_accept_ranges(
    aiohttp_client,
    service_settings,
) -> None:
    community = service_settings.content_dir / "games" / "community"
    (community / "asset.bin").write_bytes(b"0123456789")
    relay = Relay(service_settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(service_settings, relay=relay))

    response = await client.get(
        "/games/community/asset.bin",
        headers={"Range": "bytes=20-30", "Accept-Encoding": "identity"},
    )
    assert response.status == 416
    assert response.headers["Accept-Ranges"] == "bytes"
    assert response.headers["Content-Range"] == "bytes */10"


def _release(root: Path, sha: str, body: str) -> None:
    community = root / "releases" / sha / "site" / "games" / "community"
    community.mkdir(parents=True)
    (community / "index.json").write_text(body, encoding="utf-8")


def _link_live(root: Path, sha: str) -> None:
    pending = root / ".live.new"
    pending.symlink_to(Path("releases") / sha)
    pending.replace(root / "live")


@pytest.mark.asyncio
async def test_live_symlink_switch_is_visible_to_the_next_request(
    aiohttp_client,
    service_settings,
    tmp_path,
) -> None:
    root = tmp_path / "pie-game-content"
    root.mkdir()
    _release(root, "aaa", '{"games":["first"]}')
    _release(root, "bbb", '{"games":["second"]}')
    _link_live(root, "aaa")
    settings = replace(service_settings, content_dir=root / "live" / "site")
    relay = Relay(settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(settings, relay=relay))

    first = await client.get("/games/community/index.json")
    assert first.status == 200
    assert await first.text() == '{"games":["first"]}'

    _link_live(root, "bbb")

    second = await client.get("/games/community/index.json")
    assert second.status == 200
    assert await second.text() == '{"games":["second"]}'

    health = await client.get("/healthz")
    assert health.status == 200
    assert await health.json() == {"ok": True, "version": __version__, "content": True}


@pytest.mark.asyncio
async def test_missing_live_tree_returns_503_and_healthz_stays_up(
    aiohttp_client,
    service_settings,
    tmp_path,
) -> None:
    root = tmp_path / "pie-game-content"
    (root / "releases").mkdir(parents=True)
    settings = replace(service_settings, content_dir=root / "live" / "site")
    relay = Relay(settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(settings, relay=relay))

    missing = await client.get("/games/community/index.json")
    assert missing.status == 503
    assert await missing.json() == {"error": "content_unavailable"}

    sdk = await client.get("/sdk/pie-game-sdk.js")
    assert sdk.status == 503

    health = await client.get("/healthz")
    assert health.status == 200
    assert await health.json() == {"ok": True, "version": __version__, "content": False}


def test_production_settings_mount_the_whole_content_tree(monkeypatch) -> None:
    for name in ("PG_CONTENT_DIR", "PG_SITE_DIR"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings.from_env()

    assert settings.content_dir == Path("/srv/pie-content/live/site")


def test_dev_settings_use_repository_and_local_origins(monkeypatch) -> None:
    for name in (
        "PG_SHELL_PORT",
        "PG_CONTENT_PORT",
        "PG_SITE_DIR",
        "PG_CONTENT_DIR",
        "PG_SHELL_ORIGIN",
        "PG_CONTENT_ORIGIN",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("PG_API_ORIGIN", "http://127.0.0.1:59999")

    settings = Settings.from_env(dev=True)

    assert settings.shell_port == 54470
    assert settings.content_port == 54471
    assert settings.shell_origin == "http://localhost:54470"
    assert settings.content_origin == "http://127.0.0.1:54471"
    assert settings.api_origin == "http://127.0.0.1:59999"
    assert settings.site_dir == Path(__file__).resolve().parents[2] / "site"
    assert settings.content_dir == settings.site_dir


@pytest.mark.asyncio
async def test_content_app_passes_configured_retire_base(
    aiohttp_client,
    service_settings,
    monkeypatch,
) -> None:
    calls: list[tuple[str, str | None]] = []

    async def fake_redeem(ticket: str, *, base: str | None = None) -> dict:
        calls.append((ticket, base))
        return {
            "userId": "alice",
            "username": "alice",
            "displayName": "Alice",
            "gameId": "maze",
        }

    monkeypatch.setattr(relay_module.retire_client, "redeem", fake_redeem)
    client = await aiohttp_client(create_content_app(service_settings))
    ws = await client.ws_connect(
        "/mp",
        headers={"Origin": service_settings.content_origin},
    )
    await ws.send_json({"type": "auth", "ticket": "ticket", "gameId": "maze"})

    assert (await ws.receive_json(timeout=1))["type"] == "welcome"
    assert calls == [("ticket", service_settings.retire_base)]
    await ws.close()
