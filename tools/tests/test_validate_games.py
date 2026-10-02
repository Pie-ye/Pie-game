from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import validate_games

REPO = Path(__file__).resolve().parents[2]


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


def test_changed_files_two_games_fail(tmp_path: Path) -> None:
    listing = tmp_path / "changed.txt"
    listing.write_text(
        "site/games/community/a/game.json\nsite/games/community/b/game.json\n",
        encoding="utf-8",
    )
    assert validate_games.main(["--changed-files", str(listing)]) == 1


def test_spec_vectors_invalid_reason() -> None:
    errors = validate_games.run_vectors(REPO / "tests/spec_vectors.json")
    assert errors == []


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
