from __future__ import annotations

import asyncio
import json
import re
from dataclasses import replace
from pathlib import Path

import pytest

from server import boot
from server.app import create_content_app, create_shell_app
from server.relay import Relay

INDEX = """<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="./tokens.css">
  <script type="module" src="./shell.js"></script>
</head>
<body><a href="#/">大廳</a></body>
</html>"""

CASINO = {"games": [{"id": "coin-flip", "choices": []}], "rejected": []}


async def _unused_redeem(_: str):
    raise ValueError("not used")


def _write_shell(shell: Path) -> None:
    (shell / "official" / "slots").mkdir(parents=True)
    (shell / "index.html").write_text(INDEX, encoding="utf-8")
    (shell / "tokens.css").write_text(":root{}", encoding="utf-8")
    (shell / "shell.js").write_text(
        "import { a } from './api.js';\nimport './util.js';\nconst m = import('./official/slots/game.js');\n",
        encoding="utf-8",
    )
    (shell / "api.js").write_text("import { c } from './config.js';\nexport const a = c;\n", encoding="utf-8")
    (shell / "config.js").write_text("export const c = 1;\n", encoding="utf-8")
    (shell / "util.js").write_text("export {};\n", encoding="utf-8")
    (shell / "cards.js").write_text("export {};\n", encoding="utf-8")
    (shell / "official" / "_bridge.js").write_text("import '../util.js';\nexport {};\n", encoding="utf-8")
    (shell / "official" / "slots" / "game.js").write_text(
        "import '../../cards.js';\nimport { x } from '../_bridge.js';\n", encoding="utf-8"
    )


def _write_game(community: Path, game_id: str, **extra) -> None:
    (community / game_id).mkdir(parents=True, exist_ok=True)
    (community / game_id / "game.json").write_text(
        json.dumps({"id": game_id, "name": game_id, **extra}), encoding="utf-8"
    )


def _boot_data(body: str) -> dict:
    match = re.search(r'<script type="application/json" id="pg-boot">(.*?)</script>', body, re.S)
    assert match, body
    return json.loads(match.group(1))


def _release(root: Path, sha: str, games: list[str]) -> Path:
    site = root / "releases" / sha / "site"
    community = site / "games" / "community"
    community.mkdir(parents=True)
    (site / "sdk").mkdir()
    (site / "sdk" / "pie-game-sdk.js").write_text(f"// {sha}", encoding="utf-8")
    (community / "index.json").write_text(json.dumps({"games": games}), encoding="utf-8")
    for game_id in games:
        _write_game(community, game_id)
        (community / game_id / "main.js").write_text(f"// {sha} {game_id}", encoding="utf-8")
    return site


def _link_live(root: Path, sha: str) -> None:
    pending = root / ".live.new"
    pending.symlink_to(Path("releases") / sha)
    pending.replace(root / "live")


async def _casino() -> dict:
    return CASINO


def test_module_graph_follows_static_imports_only(tmp_path) -> None:
    _write_shell(tmp_path)
    assert boot.module_graph(tmp_path, ["shell.js"]) == ["shell.js", "api.js", "util.js", "config.js"]
    # 官方遊戲本身不預載，但它們共用的相依要先載好。
    assert boot.preload_modules(tmp_path) == [
        "shell.js", "api.js", "util.js", "config.js", "cards.js", "official/_bridge.js",
    ]


def test_build_id_changes_with_content_and_ignores_tests(tmp_path) -> None:
    _write_shell(tmp_path)
    first = boot.build_id(tmp_path)
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "e2e.py").write_text("x", encoding="utf-8")
    assert boot.build_id(tmp_path) == first
    (tmp_path / "config.js").write_text("export const c = 2;\n", encoding="utf-8")
    assert boot.build_id(tmp_path) != first
    assert re.fullmatch(r"[0-9a-f]{12}", first)


def test_read_catalog_drops_mismatched_and_invalid_ids(tmp_path) -> None:
    community = tmp_path / "games" / "community"
    community.mkdir(parents=True)
    (community / "index.json").write_text(
        json.dumps({"games": ["snake", {"id": "wheel"}, "liar", "../etc", "snake", "missing"]}),
        encoding="utf-8",
    )
    _write_game(community, "snake")
    _write_game(community, "wheel")
    (community / "liar").mkdir()
    (community / "liar" / "game.json").write_text('{"id": "other"}', encoding="utf-8")
    assert [g["id"] for g in boot.read_catalog(tmp_path)] == ["snake", "wheel"]


@pytest.mark.asyncio
async def test_index_embeds_boot_data_and_versions_assets(aiohttp_client, service_settings) -> None:
    shell = service_settings.site_dir / "shell"
    _write_shell(shell)
    community = service_settings.content_dir / "games" / "community"
    (community / "index.json").write_text('{"games":["evil"]}', encoding="utf-8")
    _write_game(community, "evil", description="</script><script>alert(1)</script>")
    client = await aiohttp_client(create_shell_app(service_settings, casino_fetch=_casino))

    response = await client.get("/")
    assert response.status == 200
    assert response.headers["Cache-Control"] == "no-store"
    body = await response.text()
    build = boot.build_id(shell)
    assert f'href="/s/{build}/tokens.css"' in body
    assert f'src="/s/{build}/shell.js"' in body
    assert 'href="#/"' in body
    for module in ("shell.js", "api.js", "config.js", "util.js", "cards.js", "official/_bridge.js"):
        assert f'<link rel="modulepreload" href="/s/{build}/{module}">' in body
    assert "official/slots/game.js" not in body
    assert '<link rel="preload" as="fetch" crossorigin="use-credentials" href="https://coinpilet.win/api/casino/session">' in body
    assert '<link rel="preconnect" href="http://127.0.0.1:54471" crossorigin>' in body
    # 投稿內容不受信任：不能提早關掉 script。
    assert "</script><script>alert" not in body
    data = _boot_data(body)
    assert data["build"] == build
    assert data["release"] is None
    assert data["games"][0]["description"] == "</script><script>alert(1)</script>"
    assert data["casino"] == CASINO

    assert response.headers["Link"] == (
        f"<https://coinpilet.win>; rel=preconnect, <http://127.0.0.1:54471>; rel=preconnect, "
        f"</s/{build}/tokens.css>; rel=preload; as=style, </s/{build}/shell.css>; rel=preload; as=style, "
        f"</s/{build}/shell.js>; rel=modulepreload"
    )

    assert (await client.get("/index.html")).headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_dev_index_skips_api_preload(aiohttp_client, service_settings) -> None:
    _write_shell(service_settings.site_dir / "shell")
    settings = replace(service_settings, dev=True)
    client = await aiohttp_client(create_shell_app(settings, casino_fetch=_casino))
    response = await client.get("/")
    assert "Link" not in response.headers
    body = await response.text()
    assert 'as="fetch"' not in body
    assert "https://coinpilet.win" not in body


@pytest.mark.asyncio
async def test_versioned_shell_assets_cache_only_for_current_build(aiohttp_client, service_settings) -> None:
    shell = service_settings.site_dir / "shell"
    _write_shell(shell)
    client = await aiohttp_client(create_shell_app(service_settings, casino_fetch=_casino))
    build = boot.build_id(shell)

    current = await client.get(f"/s/{build}/official/slots/game.js")
    assert current.status == 200
    assert current.headers["Cache-Control"] == "public, max-age=31536000, immutable"
    assert current.headers["Content-Type"].startswith("text/javascript") or current.headers[
        "Content-Type"
    ].startswith("application/javascript")

    stale = await client.get("/s/000000000000/config.js")
    assert stale.status == 200
    assert stale.headers["Cache-Control"] == "no-store"

    assert (await client.get(f"/s/{build}/missing.js")).status == 404
    assert (await client.get(f"/s/{build}/")).status == 404
    assert (await client.get(f"/s/{build}/index.html")).status == 404
    assert (await client.get(f"/s/{build}/official/")).status == 404
    # 舊的不帶版本路徑照樣能用（不快取）。
    assert (await client.get("/config.js")).headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_index_survives_casino_failure(aiohttp_client, service_settings) -> None:
    _write_shell(service_settings.site_dir / "shell")

    async def broken() -> dict:
        raise OSError("connection refused")

    client = await aiohttp_client(create_shell_app(service_settings, casino_fetch=broken))
    response = await client.get("/")
    assert response.status == 200
    assert _boot_data(await response.text())["casino"] is None


@pytest.mark.asyncio
async def test_casino_cache_serves_stale_while_refreshing() -> None:
    calls = 0
    gate = asyncio.Event()

    async def fetch() -> dict:
        nonlocal calls
        calls += 1
        if calls > 1:
            await gate.wait()
        return {"games": [], "n": calls}

    cache = boot.CasinoListCache(fetch, ttl=0.0, first_wait=1.0)
    assert (await cache.get())["n"] == 1
    # 過期：立刻回舊值，背景更新卡住也不影響。
    assert (await asyncio.wait_for(cache.get(), 0.1))["n"] == 1
    gate.set()
    await asyncio.sleep(0.01)
    assert (await cache.get())["n"] == 2
    await cache.close()


@pytest.mark.asyncio
async def test_casino_cache_first_request_waits_briefly() -> None:
    async def slow() -> dict:
        await asyncio.sleep(5)
        return {"games": []}

    cache = boot.CasinoListCache(slow, first_wait=0.05)
    assert await asyncio.wait_for(cache.get(), 1) is None
    await cache.close()


@pytest.mark.asyncio
async def test_release_paths_are_immutable_and_keep_old_releases(
    aiohttp_client,
    service_settings,
    tmp_path,
) -> None:
    root = tmp_path / "pie-game-content"
    old = "a" * 40
    new = "b" * 40
    _release(root, old, ["snake"])
    _release(root, new, ["snake", "wheel"])
    _link_live(root, new)
    settings = replace(service_settings, content_dir=root / "live" / "site")
    relay = Relay(settings.content_origin, redeem=_unused_redeem)
    client = await aiohttp_client(create_content_app(settings, relay=relay))

    current = await client.get(f"/r/{new}/games/community/snake/main.js")
    assert current.status == 200
    assert await current.text() == f"// {new} snake"
    assert current.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    sdk = await client.get(f"/r/{new}/sdk/pie-game-sdk.js")
    assert await sdk.text() == f"// {new}"
    assert sdk.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    meta = await client.get(f"/r/{new}/games/community/wheel/game.json")
    assert meta.headers["Access-Control-Allow-Origin"] == settings.shell_origin

    # 開著舊頁面的人：舊 release 還在就給舊的那一版。
    previous = await client.get(f"/r/{old}/games/community/snake/main.js")
    assert await previous.text() == f"// {old} snake"
    assert previous.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    # 已經清掉的 release：退回現在的內容，不快取。
    pruned = await client.get(f"/r/{'c' * 40}/games/community/snake/main.js")
    assert await pruned.text() == f"// {new} snake"
    assert pruned.headers["Cache-Control"] == "no-store"

    assert (await client.get(f"/r/{new}/games/community/../../../../etc/passwd")).status == 404
    assert (await client.get(f"/r/{new}/tools/x.py")).status == 404


@pytest.mark.asyncio
async def test_shell_boot_release_matches_live(aiohttp_client, service_settings, tmp_path) -> None:
    root = tmp_path / "pie-game-content"
    sha = "d" * 40
    _release(root, sha, ["snake"])
    _link_live(root, sha)
    settings = replace(service_settings, content_dir=root / "live" / "site")
    _write_shell(settings.site_dir / "shell")
    client = await aiohttp_client(create_shell_app(settings, casino_fetch=_casino))

    data = _boot_data(await (await client.get("/")).text())
    assert data["release"] == sha
    assert [g["id"] for g in data["games"]] == ["snake"]

    sha2 = "e" * 40
    _release(root, sha2, ["snake", "wheel"])
    _link_live(root, sha2)
    data = _boot_data(await (await client.get("/")).text())
    assert data["release"] == sha2
    assert [g["id"] for g in data["games"]] == ["snake", "wheel"]
