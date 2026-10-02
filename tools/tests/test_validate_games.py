from __future__ import annotations

import ast
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import validate_games

REPO = Path(__file__).resolve().parents[2]
UPSTREAM_COMMUNITY = Path("/home/pieye/Container/Retire-count-casino/server/casino/community.py")
UPSTREAM_VECTORS = Path("/home/pieye/Container/Retire-count-casino/tests/fixtures/community_spec_vectors.json")
UPSTREAM_ROOT = Path("/home/pieye/Container/Retire-count-casino")
HASH_RECORD = REPO / "tools/upstream_validate_spec.sha256"
COPIED_FUNCTIONS = ("validate_spec", "rtp_for_bet")
SYNC_HINT = (
    "上游的規格驗證碼已變更：請把 tools/validate_games.py 開頭複製的那一段同步成新版，"
    f"再更新 {HASH_RECORD.name} 的 commit 與 sha256。"
)


def _normalized_hash(source_path: Path, function_name: str) -> str:
    """函式原始碼的正規化雜湊：ast.unparse 後取 sha256，忽略註解與排版差異。"""
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == function_name:
            return hashlib.sha256(ast.unparse(node).encode("utf-8")).hexdigest()
    raise AssertionError(f"{source_path} 裡找不到 {function_name}")


def _hash_record() -> dict[str, str]:
    record: dict[str, str] = {}
    for line in HASH_RECORD.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, _, value = stripped.partition("=")
        record[key.strip()] = value.strip()
    return record


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _game_json(game_id: str, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": game_id,
        "name": "測試遊戲",
        "kind": "free",
        "multiplayer": False,
        "author": "tester",
        "entry": "index.html",
        "description": "單元測試用",
        "tags": ["test"],
    }
    payload.update(overrides)
    return payload


def _valid_tree(root: Path, game_id: str = "demo-game", **overrides: object) -> Path:
    game_dir = root / game_id
    _write(game_dir / "index.html", "<!DOCTYPE html><title>ok</title>")
    _write(game_dir / "README.md", "# demo")
    _write(game_dir / "game.json", json.dumps(_game_json(game_id, **overrides), ensure_ascii=False))
    _write(root / "index.json", json.dumps({"games": [game_id]}))
    return game_dir


def test_community_examples_pass() -> None:
    assert validate_games.main([str(REPO / "site/games/community")]) == 0


def test_vectors_file_passes() -> None:
    assert validate_games.main(["--vectors", str(REPO / "tests/spec_vectors.json")]) == 0


def test_bad_game_json(tmp_path: Path) -> None:
    _valid_tree(tmp_path, "demo-game", kind="nope")
    errors = validate_games.validate_community(tmp_path)
    assert any("kind 必須是 free 或 coin" in item for item in errors)


def test_missing_readme(tmp_path: Path) -> None:
    game_dir = _valid_tree(tmp_path)
    (game_dir / "README.md").unlink()
    errors = validate_games.validate_community(tmp_path)
    assert any("缺少 README.md" in item for item in errors)


def test_coin_requires_spec(tmp_path: Path) -> None:
    _valid_tree(tmp_path, "coin-demo", kind="coin")
    errors = validate_games.validate_community(tmp_path)
    assert any("spec.json" in item for item in errors)


def test_coin_cannot_be_multiplayer(tmp_path: Path) -> None:
    _valid_tree(tmp_path, "coin-demo", kind="coin", multiplayer=True)
    spec = {
        "specVersion": 1,
        "id": "coin-demo",
        "name": "測試",
        "author": "tester",
        "minBet": 5,
        "maxBet": 100,
        "choices": [
            {
                "id": "play",
                "label": "開始",
                "outcomes": [
                    {"id": "win", "label": "贏", "weight": 48, "return": "2"},
                    {"id": "lose", "label": "輸", "weight": 52, "return": "0"},
                ],
            }
        ],
    }
    _write(tmp_path / "coin-demo" / "spec.json", json.dumps(spec))
    errors = validate_games.validate_community(tmp_path)
    assert any("金幣遊戲不可設 multiplayer" in item for item in errors)


def test_external_url_in_html(tmp_path: Path) -> None:
    game_dir = _valid_tree(tmp_path)
    _write(
        game_dir / "index.html",
        '<!DOCTYPE html><script src="https://cdn.example/x.js"></script>',
    )
    errors = validate_games.validate_community(tmp_path)
    assert any("不得引用外部網址" in item for item in errors)


def test_protocol_relative_css_url(tmp_path: Path) -> None:
    game_dir = _valid_tree(tmp_path)
    _write(game_dir / "style.css", "body{background:url(//evil.example/bg.png)}")
    errors = validate_games.validate_community(tmp_path)
    assert any("不得引用外部網址" in item for item in errors)


def test_anchor_external_requires_noopener(tmp_path: Path) -> None:
    game_dir = _valid_tree(tmp_path)
    _write(game_dir / "index.html", '<!DOCTYPE html><a href="https://example.com">x</a>')
    errors = validate_games.validate_community(tmp_path)
    assert any("noopener" in item for item in errors)
    _write(
        game_dir / "index.html",
        '<!DOCTYPE html><a href="https://example.com" rel="noopener">x</a>',
    )
    assert validate_games.validate_community(tmp_path) == []


def test_oversized_file(tmp_path: Path) -> None:
    game_dir = _valid_tree(tmp_path)
    huge = game_dir / "blob.bin"
    huge.touch()
    os.truncate(huge, validate_games.GAME_FILE_MAX_BYTES + 1)
    errors = validate_games.validate_community(tmp_path)
    assert any("單檔超過 25 MiB" in item for item in errors)


def test_index_inconsistency(tmp_path: Path) -> None:
    _valid_tree(tmp_path, "demo-game")
    _write(tmp_path / "index.json", json.dumps({"games": ["other-game"]}))
    errors = validate_games.validate_community(tmp_path)
    assert any("不存在的遊戲 other-game" in item for item in errors)
    assert any("未列入 index.json" in item for item in errors)


def test_changed_files_single_game(tmp_path: Path) -> None:
    listing = tmp_path / "changed.txt"
    listing.write_text(
        "\n".join(
            [
                "site/games/community/demo-game/game.json",
                "site/games/community/index.json",
            ]
        ),
        encoding="utf-8",
    )
    assert validate_games.main(["--changed-files", str(listing)]) == 0


def test_changed_files_owner_warning(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    listing = tmp_path / "changed.txt"
    listing.write_text("server/app.py\nsite/games/community/demo-game/main.js\n", encoding="utf-8")
    assert validate_games.main(["--changed-files", str(listing)]) == 0
    err = capsys.readouterr().err
    assert "需要擁有者審核" in err


def test_changed_files_non_owner_platform_change_fails(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    listing = tmp_path / "changed.txt"
    listing.write_text(
        "\n".join(
            [
                "server/app.py",
                ".github/workflows/validate.yml",
                "site/games/community/_template-free/main.js",
                "site/games/community/demo-game/main.js",
                "site/games/community/index.json",
            ]
        ),
        encoding="utf-8",
    )
    arguments = ["--changed-files", str(listing), "--pr-author", "outsider", "--repo-owner", "Pie-ye"]

    assert validate_games.main(arguments) == 1
    err = capsys.readouterr().err
    assert "server/app.py：投稿 PR 只能改" in err
    assert ".github/workflows/validate.yml：投稿 PR 只能改" in err
    assert "_template-free/main.js：投稿 PR 只能改" in err
    assert "demo-game" not in err


def test_changed_files_owner_platform_change_only_warns(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    listing = tmp_path / "changed.txt"
    listing.write_text("server/app.py\n", encoding="utf-8")

    assert validate_games.main(
        ["--changed-files", str(listing), "--pr-author", "pie-YE", "--repo-owner", "Pie-ye"]
    ) == 0
    assert "需要擁有者審核" in capsys.readouterr().err


def test_changed_files_two_games_fail(tmp_path: Path) -> None:
    listing = tmp_path / "changed.txt"
    listing.write_text(
        "site/games/community/a/game.json\nsite/games/community/b/game.json\n",
        encoding="utf-8",
    )
    assert validate_games.main(["--changed-files", str(listing)]) == 1


def test_spec_vectors_invalid_reason() -> None:
    data = json.loads((REPO / "tests/spec_vectors.json").read_text(encoding="utf-8"))
    assert data["invalid"], "向量檔應有不合法案例"
    for index, item in enumerate(data["invalid"]):
        needle = item["reason_contains"]
        ok, reason, _rtp = validate_games.validate_spec(item["spec"])
        assert ok is False, f"invalid[{index}] 應失敗"
        assert needle in (reason or ""), f"invalid[{index}] 原因應含「{needle}」，實際：{reason}"


def test_local_copy_matches_recorded_upstream_hash() -> None:
    """CI 也跑得到：本檔複製的規格驗證碼必須等於記錄下來的上游快照。"""
    record = _hash_record()
    assert len(record["commit"]) == 40
    for name in COPIED_FUNCTIONS:
        expected = record[f"{name}_sha256"]
        assert len(expected) == 64
        assert _normalized_hash(REPO / "tools/validate_games.py", name) == expected, SYNC_HINT


def test_recorded_hash_still_matches_upstream_source() -> None:
    if not UPSTREAM_COMMUNITY.is_file():
        pytest.skip("上游 community.py 不存在")
    record = _hash_record()
    for name in COPIED_FUNCTIONS:
        assert _normalized_hash(UPSTREAM_COMMUNITY, name) == record[f"{name}_sha256"], SYNC_HINT


def test_spec_vectors_sha256_matches_upstream() -> None:
    if not UPSTREAM_VECTORS.is_file():
        pytest.skip("上游 community_spec_vectors.json 不存在")
    ours = hashlib.sha256((REPO / "tests/spec_vectors.json").read_bytes()).hexdigest()
    theirs = hashlib.sha256(UPSTREAM_VECTORS.read_bytes()).hexdigest()
    assert ours == theirs


def test_validate_spec_matches_upstream_on_every_vector() -> None:
    if not UPSTREAM_COMMUNITY.is_file():
        pytest.skip("上游 community.py 不存在")
    vectors_path = REPO / "tests/spec_vectors.json"
    script = r"""
import json, sys
from server.casino.community import validate_spec
data = json.load(open(sys.argv[1], encoding="utf-8"))
out = []
for spec in data["valid"]:
    ok, reason, rtp = validate_spec(spec)
    out.append({"ok": ok, "reason": reason, "rtp": rtp})
for item in data["invalid"]:
    ok, reason, rtp = validate_spec(item["spec"])
    out.append({"ok": ok, "reason": reason, "rtp": rtp})
json.dump(out, sys.stdout)
"""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(UPSTREAM_ROOT)
    proc = subprocess.run(
        [sys.executable, "-c", script, str(vectors_path)],
        check=True,
        capture_output=True,
        text=True,
        env=env,
        cwd=str(UPSTREAM_ROOT),
    )
    upstream = json.loads(proc.stdout)
    data = json.loads(vectors_path.read_text(encoding="utf-8"))
    local: list[dict[str, object]] = []
    for spec in data["valid"]:
        ok, reason, rtp = validate_games.validate_spec(spec)
        local.append({"ok": ok, "reason": reason, "rtp": rtp})
    for item in data["invalid"]:
        ok, reason, rtp = validate_games.validate_spec(item["spec"])
        local.append({"ok": ok, "reason": reason, "rtp": rtp})
    assert json.loads(json.dumps(local)) == upstream


def test_unquoted_script_src(tmp_path: Path) -> None:
    game_dir = _valid_tree(tmp_path)
    _write(game_dir / "index.html", "<!DOCTYPE html><script src=https://cdn.example/x.js></script>")
    errors = validate_games.validate_community(tmp_path)
    assert any("不得引用外部網址" in item for item in errors)


def test_srcset_poster_import_meta_refresh(tmp_path: Path) -> None:
    game_dir = _valid_tree(tmp_path)
    _write(
        game_dir / "index.html",
        """<!DOCTYPE html>
<img srcset="https://cdn.example/a.png 1x, //cdn.example/b.png 2x">
<video poster=https://cdn.example/p.jpg></video>
<meta http-equiv="refresh" content="0;url=https://evil.example/">
<link href=https://cdn.example/x.css rel=stylesheet>
""",
    )
    _write(game_dir / "style.css", '@import url("https://fonts.example/x.css");')
    errors = validate_games.validate_community(tmp_path)
    joined = "\n".join(errors)
    assert "srcset=" in joined
    assert "poster=" in joined
    assert "meta refresh=" in joined
    assert "href=" in joined
    assert "@import" in joined or "url(" in joined


def test_index_json_rejects_object_entries_and_overlong_lists(tmp_path: Path) -> None:
    _valid_tree(tmp_path, "demo-game")
    _write(tmp_path / "index.json", json.dumps({"games": [{"id": "demo-game"}]}))
    errors = validate_games.validate_community(tmp_path)
    assert any("必須是字串 id 陣列" in item for item in errors)

    _write(
        tmp_path / "index.json",
        json.dumps({"games": [f"game-{index}" for index in range(201)]}),
    )
    errors = validate_games.validate_community(tmp_path)
    assert any("最多 200 個" in item for item in errors)


def test_symlinks_are_rejected(tmp_path: Path) -> None:
    game_dir = _valid_tree(tmp_path)
    outside = tmp_path.parent / "outside.txt"
    outside.write_text("secret", encoding="utf-8")

    (game_dir / "leak.txt").symlink_to(outside)
    errors = validate_games.validate_community(tmp_path)
    assert any("leak.txt：不可使用符號連結" in item for item in errors)
    (game_dir / "leak.txt").unlink()

    (game_dir / "assets").symlink_to(tmp_path.parent, target_is_directory=True)
    errors = validate_games.validate_community(tmp_path)
    assert any("assets：不可使用符號連結" in item for item in errors)
    (game_dir / "assets").unlink()

    assert validate_games.validate_community(tmp_path) == []

    (tmp_path / "linked-game").symlink_to(game_dir, target_is_directory=True)
    errors = validate_games.validate_community(tmp_path)
    assert any("linked-game：不可使用符號連結" in item for item in errors)


def test_templates_are_validated_without_index_entry(tmp_path: Path) -> None:
    _valid_tree(tmp_path, "demo-game")
    template = tmp_path / "_template-free"
    _write(template / "index.html", "<!DOCTYPE html><title>ok</title>")
    _write(template / "README.md", "# template")
    _write(
        template / "game.json",
        json.dumps(_game_json("my-free-game"), ensure_ascii=False),
    )
    # 資料夾名稱與 id 不同、也沒列進 index.json，範本規則都允許。
    assert validate_games.validate_community(tmp_path) == []

    _write(template / "game.json", json.dumps(_game_json("my-free-game", kind="nope")))
    errors = validate_games.validate_community(tmp_path)
    assert any("kind 必須是 free 或 coin" in item for item in errors)

    _write(template / "game.json", json.dumps(_game_json("my-free-game")))
    _write(template / "style.css", "body{background:url(https://evil.example/bg.png)}")
    errors = validate_games.validate_community(tmp_path)
    assert any("不得引用外部網址" in item for item in errors)


def test_reserved_underscore_folder_is_rejected(tmp_path: Path) -> None:
    _valid_tree(tmp_path, "demo-game")
    _write(tmp_path / "_private" / "README.md", "# nope")
    errors = validate_games.validate_community(tmp_path)
    assert any("保留給 _template-* 範本" in item for item in errors)


def test_repository_templates_pass_validation() -> None:
    community = REPO / "site/games/community"
    for template in sorted(community.glob("_template-*")):
        assert validate_games.validate_game_dir(template, template=True) == []


def test_coin_flip_rtp() -> None:
    spec = json.loads((REPO / "site/games/community/coin-flip/spec.json").read_text(encoding="utf-8"))
    ok, reason, rtp = validate_games.validate_spec(spec)
    assert ok, reason
    assert rtp["heads"] == pytest.approx(0.96)
    assert rtp["tails"] == pytest.approx(0.96)


def test_lucky_wheel_rtp_band() -> None:
    spec = json.loads((REPO / "site/games/community/lucky-wheel/spec.json").read_text(encoding="utf-8"))
    ok, reason, rtp = validate_games.validate_spec(spec)
    assert ok, reason
    value = rtp["spin"]
    assert 0.94 <= value <= 0.96
