#!/usr/bin/env python3
"""驗證投稿遊戲目錄、game.json、金幣規格與 PR 變更範圍。

validate_spec 複製自股票大亂鬥 server/casino/community.py。
來源工作樹：/home/pieye/Container/Retire-count-casino
當時 HEAD：86eb49bcacfe5e36556bc9ce03b649518ff825fb
該檔於複製時尚未提交（S2 進行中）；規則與 design §1.5、S2 brief 一致。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from fractions import Fraction
from pathlib import Path
from typing import Any

# --- 以下 validate_spec 與其常數與股票大亂鬥 community.py 相同 ---
MAX_FILE_BYTES = 64 * 1024  # 單檔與整份規格上限 64 KB
MAX_DISPLAY_ITEM_BYTES = 2 * 1024  # display 單項上限 2 KB
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}$")


def validate_spec(obj: Any) -> tuple[bool, str | None, dict[str, float]]:
    """驗證社群金幣遊戲規格檔。

    全部計算使用 fractions.Fraction 避免浮點數誤差。
    回傳 (ok, reason, rtp_by_choice)。reason 為繁體中文，可直接顯示給維護者。
    """
    if not isinstance(obj, dict):
        return False, "規格必須為 JSON 物件", {}

    # 1. 整份 JSON 大小檢查（≤ 64 KB）
    try:
        raw_bytes = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        return False, f"規格無法序列化為 JSON：{exc}", {}
    if len(raw_bytes) > MAX_FILE_BYTES:
        return False, "整份規格大小超過 64 KB", {}

    # 2. 根層級必要欄位
    for field in ("specVersion", "id", "name", "author", "minBet", "maxBet", "choices"):
        if field not in obj:
            return False, f"缺少必要欄位：{field}", {}

    # 3. specVersion == 1（整數，不能是 bool）
    if obj["specVersion"] != 1 or isinstance(obj["specVersion"], bool):
        return False, "specVersion 必須為整數 1", {}

    # 4. id 符合 ^[a-z0-9][a-z0-9-]{1,30}$
    gid = obj["id"]
    if not isinstance(gid, str) or not ID_PATTERN.fullmatch(gid):
        return False, f"遊戲 id 格式不正確：'{gid}'（需符合 ^[a-z0-9][a-z0-9-]{{1,30}}$）", {}

    # 5. name 1–20 字
    name = obj["name"]
    if not isinstance(name, str) or not (1 <= len(name) <= 20):
        return False, "遊戲名稱長度必須為 1–20 字", {}

    # 6. author 1–39 字
    author = obj["author"]
    if not isinstance(author, str) or not (1 <= len(author) <= 39):
        return False, "作者名稱長度必須為 1–39 字", {}

    # 7. 5 ≤ minBet ≤ maxBet ≤ 100（整數）
    min_bet = obj["minBet"]
    max_bet = obj["maxBet"]
    if (
        not isinstance(min_bet, int)
        or isinstance(min_bet, bool)
        or not isinstance(max_bet, int)
        or isinstance(max_bet, bool)
    ):
        return False, "押注金額 minBet 與 maxBet 必須為整數", {}
    if not (5 <= min_bet <= max_bet <= 100):
        return False, f"押注範圍必須符合 5 ≤ minBet ≤ maxBet ≤ 100（目前為 {min_bet}–{max_bet}）", {}

    # 8. choices 1–12 個且 id 不重複
    choices = obj["choices"]
    if not isinstance(choices, list) or not (1 <= len(choices) <= 12):
        return False, "choices 數量必須在 1–12 之間", {}

    choice_ids: set[str] = set()
    rtp_by_choice: dict[str, float] = {}
    max_rtp_fraction = Fraction(98, 100)

    for choice in choices:
        if not isinstance(choice, dict):
            return False, "choice 必須為物件", {}

        for c_field in ("id", "label", "outcomes"):
            if c_field not in choice:
                return False, f"選項缺少必要欄位：{c_field}", {}

        cid = choice["id"]
        if not isinstance(cid, str) or not ID_PATTERN.fullmatch(cid):
            return False, f"選項 id 格式不正確：'{cid}'", {}
        if cid in choice_ids:
            return False, f"選項 id 重複：'{cid}'", {}
        choice_ids.add(cid)

        clabel = choice["label"]
        if not isinstance(clabel, str) or not (1 <= len(clabel) <= 20):
            return False, f"選項 '{cid}' 的名稱長度必須為 1–20 字", {}

        # outcomes 2–64 個且 id 不重複
        outcomes = choice["outcomes"]
        if not isinstance(outcomes, list) or not (2 <= len(outcomes) <= 64):
            return False, f"選項 '{cid}' 的 outcomes 數量必須在 2–64 之間", {}

        outcome_ids: set[str] = set()
        parsed_outcomes: list[tuple[int, Fraction]] = []

        for outcome in outcomes:
            if not isinstance(outcome, dict):
                return False, f"選項 '{cid}' 的結果必須為物件", {}

            for o_field in ("id", "label", "weight", "return"):
                if o_field not in outcome:
                    return False, f"選項 '{cid}' 的結果缺少必要欄位：{o_field}", {}

            oid = outcome["id"]
            if not isinstance(oid, str) or not ID_PATTERN.fullmatch(oid):
                return False, f"選項 '{cid}' 的結果 id 格式不正確：'{oid}'", {}
            if oid in outcome_ids:
                return False, f"選項 '{cid}' 的結果 id 重複：'{oid}'", {}
            outcome_ids.add(oid)

            olabel = outcome["label"]
            if not isinstance(olabel, str) or not (1 <= len(olabel) <= 20):
                return False, f"結果 '{oid}' 的名稱長度必須為 1–20 字", {}

            # weight 為 1–1,000,000 的整數（bool 不算）
            weight = outcome["weight"]
            if not isinstance(weight, int) or isinstance(weight, bool) or not (1 <= weight <= 1_000_000):
                return False, f"結果 '{oid}' 的 weight 必須為 1–1,000,000 的整數", {}

            # return 為字串，可解析成非負 Fraction（整數、小數或 a/b），分母 ≤ 1000、值 ≤ 1000
            ret_str = outcome["return"]
            if not isinstance(ret_str, str):
                return False, f"結果 '{oid}' 的 return 必須為字串", {}
            try:
                ret_frac = Fraction(ret_str)
            except (ValueError, ZeroDivisionError):
                return False, f"結果 '{oid}' 的 return 格式無法解析", {}
            if ret_frac < 0:
                return False, f"結果 '{oid}' 的 return 不能為負數", {}
            if ret_frac.denominator > 1000:
                return False, f"結果 '{oid}' 的 return 分母不可超過 1000", {}
            if ret_frac > 1000:
                return False, f"結果 '{oid}' 的 return 數值不可超過 1000", {}

            # display（可選）：list，長度 1–32，每項任意 JSON，序列化後單項 ≤ 2 KB
            if "display" in outcome and outcome["display"] is not None:
                display = outcome["display"]
                if not isinstance(display, list) or not (1 <= len(display) <= 32):
                    return False, f"結果 '{oid}' 的 display 必須為長度 1–32 的陣列", {}
                for d_idx, d_item in enumerate(display):
                    try:
                        d_bytes = json.dumps(d_item, ensure_ascii=False).encode("utf-8")
                    except (TypeError, ValueError):
                        return False, f"結果 '{oid}' 的 display[{d_idx}] 無法序列化為 JSON", {}
                    if len(d_bytes) > MAX_DISPLAY_ITEM_BYTES:
                        return False, f"結果 '{oid}' 的 display 單項不可超過 2 KB", {}

            parsed_outcomes.append((weight, ret_frac))

        # 9. 期望值驗證：
        # 對 minBet..maxBet 的每一個整數押注，以實際派彩 floor(bet × return) 計算 RTP：
        # RTP = Σ(weight × floor(bet×return)) / (Σweight × bet)，全部必須 ≤ 98/100
        sum_weight = sum(w for w, _ in parsed_outcomes)

        # 標稱 RTP
        nominal_rtp = sum(w * rf for w, rf in parsed_outcomes) / sum_weight
        if nominal_rtp > max_rtp_fraction:
            return False, f"選項 '{cid}' 期望回饋率超過 98%（{float(nominal_rtp):.4f}）", {}

        for bet in range(min_bet, max_bet + 1):
            total_payout = sum(
                w * ((bet * rf.numerator) // rf.denominator)
                for w, rf in parsed_outcomes
            )
            bet_rtp = Fraction(total_payout, sum_weight * bet)
            if bet_rtp > max_rtp_fraction:
                return False, f"選項 '{cid}' 在押注 {bet} 時回饋率超過 98%（{float(bet_rtp):.4f}）", {}

        rtp_by_choice[cid] = float(nominal_rtp)

    return True, None, rtp_by_choice


# --- 投稿目錄規則 ---
GAME_FILE_MAX_BYTES = 25 * 1024 * 1024  # 25 MiB
GAME_TOTAL_MAX_BYTES = 50 * 1024 * 1024  # 50 MB（以 50 MiB 計）
REQUIRED_GAME_FIELDS = ("id", "name", "kind", "multiplayer", "author", "entry", "description", "tags")
SRC_HREF_RE = re.compile(r'(?P<attr>src|href)\s*=\s*(?P<q>["\'])(?P<url>.*?)(?P=q)', re.IGNORECASE | re.DOTALL)
URL_FN_RE = re.compile(r'url\(\s*(?P<q>["\']?)(?P<url>.*?)(?P=q)\s*\)', re.IGNORECASE | re.DOTALL)
A_TAG_RE = re.compile(r"<a\b([^>]*)>", re.IGNORECASE | re.DOTALL)
COMMUNITY_PREFIX = "site/games/community/"


def _is_external_url(url: str) -> bool:
    stripped = url.strip()
    return stripped.startswith("http://") or stripped.startswith("https://") or stripped.startswith("//")


def _rel_has_noopener(attrs: str) -> bool:
    match = re.search(r"""\brel\s*=\s*(['"])(.*?)\1""", attrs, re.IGNORECASE | re.DOTALL)
    if match is None:
        return False
    tokens = re.split(r"\s+", match.group(2).lower())
    return "noopener" in tokens


def _line_at(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def check_external_resources(path: Path, text: str) -> list[str]:
    """HTML／CSS 不得載入外部資源；<a href> 外連必須 rel=noopener。"""
    errors: list[str] = []
    rel = str(path)

    for match in A_TAG_RE.finditer(text):
        attrs = match.group(1)
        href_match = re.search(r"""\bhref\s*=\s*(['"])(.*?)\1""", attrs, re.IGNORECASE | re.DOTALL)
        if href_match is None:
            continue
        url = href_match.group(2).strip()
        if _is_external_url(url) and not _rel_has_noopener(attrs):
            errors.append(f"{rel}:{_line_at(text, match.start())}：外連 <a href> 必須加上 rel=\"noopener\"")

    for match in SRC_HREF_RE.finditer(text):
        url = match.group("url").strip()
        if not _is_external_url(url):
            continue
        attr = match.group("attr").lower()
        if attr == "href":
            before = text[: match.start()]
            last_lt = before.rfind("<")
            last_gt = before.rfind(">")
            if last_lt > last_gt and re.match(r"<a\b", text[last_lt : match.start() + 8], re.IGNORECASE):
                continue
        errors.append(f"{rel}:{_line_at(text, match.start())}：不得引用外部網址（{attr}={url[:80]}）")

    for match in URL_FN_RE.finditer(text):
        url = match.group("url").strip()
        if _is_external_url(url):
            errors.append(f"{rel}:{_line_at(text, match.start())}：不得引用外部網址（url({url[:80]})）")
    return errors


def _iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name != ".git"]
        for name in filenames:
            files.append(Path(dirpath) / name)
    return files


def _load_json(path: Path) -> tuple[Any, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except FileNotFoundError:
        return None, f"{path}：檔案不存在"
    except UnicodeDecodeError:
        return None, f"{path}：不是 UTF-8 文字"
    except json.JSONDecodeError as exc:
        return None, f"{path}：JSON 無法解析（{exc}）"


def validate_game_dir(game_dir: Path) -> list[str]:
    errors: list[str] = []
    game_id = game_dir.name
    game_json_path = game_dir / "game.json"
    readme_path = game_dir / "README.md"

    if not ID_PATTERN.fullmatch(game_id):
        errors.append(f"{game_dir}：資料夾名稱不符合 id 規則 ^[a-z0-9][a-z0-9-]{{1,30}}$")

    if not readme_path.is_file():
        errors.append(f"{readme_path}：缺少 README.md")

    data, json_error = _load_json(game_json_path)
    if json_error:
        errors.append(json_error)
        return errors
    if not isinstance(data, dict):
        errors.append(f"{game_json_path}：必須為 JSON 物件")
        return errors

    for field in REQUIRED_GAME_FIELDS:
        if field not in data:
            errors.append(f"{game_json_path}：缺少必要欄位 {field}")

    gid = data.get("id")
    if not isinstance(gid, str) or not ID_PATTERN.fullmatch(gid):
        errors.append(f"{game_json_path}：id 格式不正確")
    elif gid != game_id:
        errors.append(f"{game_json_path}：id「{gid}」與資料夾「{game_id}」不一致")

    name = data.get("name")
    if "name" in data and (not isinstance(name, str) or not name.strip()):
        errors.append(f"{game_json_path}：name 必須為非空字串")

    kind = data.get("kind")
    if "kind" in data and kind not in {"free", "coin"}:
        errors.append(f"{game_json_path}：kind 必須是 free 或 coin")

    multiplayer = data.get("multiplayer")
    if "multiplayer" in data and not isinstance(multiplayer, bool):
        errors.append(f"{game_json_path}：multiplayer 必須為布林值")

    if kind == "coin" and multiplayer is True:
        errors.append(f"{game_json_path}：金幣遊戲不可設 multiplayer")

    author = data.get("author")
    if "author" in data and (not isinstance(author, str) or not author.strip()):
        errors.append(f"{game_json_path}：author 必須為非空字串")

    description = data.get("description")
    if "description" in data and not isinstance(description, str):
        errors.append(f"{game_json_path}：description 必須為字串")

    tags = data.get("tags")
    if "tags" in data and (
        not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags)
    ):
        errors.append(f"{game_json_path}：tags 必須為字串陣列")

    if "source" in data and data["source"] is not None and not isinstance(data["source"], str):
        errors.append(f"{game_json_path}：source 必須為字串")

    entry = data.get("entry")
    if not isinstance(entry, str) or not entry.strip():
        errors.append(f"{game_json_path}：entry 必須為相對路徑")
    else:
        if entry.startswith("/") or "\\" in entry or any(part == ".." for part in entry.split("/")):
            errors.append(f"{game_json_path}：entry 不可為絕對路徑或含 ..")
        else:
            entry_path = game_dir.joinpath(*entry.split("/"))
            if not entry_path.is_file():
                errors.append(f"{game_json_path}：entry 檔不存在（{entry}）")

    if kind == "coin":
        spec_path = game_dir / "spec.json"
        spec, spec_error = _load_json(spec_path)
        if spec_error:
            errors.append(f"{spec_path}：金幣遊戲必須附 spec.json（{spec_error}）")
        else:
            ok, reason, _rtp = validate_spec(spec)
            if not ok:
                errors.append(f"{spec_path}：規格驗證失敗：{reason}")
            elif isinstance(spec, dict) and spec.get("id") != gid:
                errors.append(f"{spec_path}：spec.id 必須與 game.json id 相同")

    total = 0
    for file_path in _iter_files(game_dir):
        try:
            size = file_path.stat().st_size
        except OSError as exc:
            errors.append(f"{file_path}：無法讀取大小（{exc}）")
            continue
        total += size
        if size > GAME_FILE_MAX_BYTES:
            errors.append(f"{file_path}：單檔超過 25 MiB（{size} bytes）")
        suffix = file_path.suffix.lower()
        if suffix in {".html", ".htm", ".css"}:
            try:
                text = file_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                errors.append(f"{file_path}：HTML／CSS 必須為 UTF-8")
                continue
            errors.extend(check_external_resources(file_path, text))
    if total > GAME_TOTAL_MAX_BYTES:
        errors.append(f"{game_dir}：單一遊戲超過 50 MB（{total} bytes）")
    return errors


def listed_game_ids(index_data: Any) -> tuple[list[str], str | None]:
    if not isinstance(index_data, dict):
        return [], "index.json 必須為物件"
    games = index_data.get("games")
    if not isinstance(games, list):
        return [], "index.json 缺少 games 陣列"
    ids: list[str] = []
    for item in games:
        if isinstance(item, str):
            ids.append(item)
        elif isinstance(item, dict) and isinstance(item.get("id"), str):
            ids.append(item["id"])
        else:
            return [], "index.json 的 games 必須是字串 id 或含 id 的物件"
    return ids, None


def validate_community(root: Path) -> list[str]:
    errors: list[str] = []
    if not root.is_dir():
        return [f"{root}：目錄不存在"]

    index_path = root / "index.json"
    index_data, index_error = _load_json(index_path)
    if index_error:
        errors.append(index_error)
        listed: list[str] = []
    else:
        listed, listed_error = listed_game_ids(index_data)
        if listed_error:
            errors.append(f"{index_path}：{listed_error}")
            listed = []

    disk_ids = sorted(
        path.name
        for path in root.iterdir()
        if path.is_dir() and not path.name.startswith("_")
    )
    listed_set = set(listed)
    disk_set = set(disk_ids)
    for missing in sorted(listed_set - disk_set):
        errors.append(f"{index_path}：列出了不存在的遊戲 {missing}")
    for extra in sorted(disk_set - listed_set):
        errors.append(f"{root / extra}：未列入 index.json")
    if len(listed) != len(listed_set):
        errors.append(f"{index_path}：games 有重複 id")

    for game_id in disk_ids:
        errors.extend(validate_game_dir(root / game_id))
    return errors


def run_vectors(path: Path) -> list[str]:
    data, error = _load_json(path)
    if error:
        return [error]
    if not isinstance(data, dict):
        return [f"{path}：向量檔必須為物件"]
    errors: list[str] = []
    valid = data.get("valid") or []
    invalid = data.get("invalid") or []
    if not isinstance(valid, list) or not isinstance(invalid, list):
        return [f"{path}：valid／invalid 必須為陣列"]
    for index, spec in enumerate(valid):
        ok, reason, _rtp = validate_spec(spec)
        if not ok:
            spec_id = spec.get("id") if isinstance(spec, dict) else "?"
            errors.append(f"{path}：valid[{index}]（{spec_id}）應通過，實際：{reason}")
    for index, item in enumerate(invalid):
        if not isinstance(item, dict):
            errors.append(f"{path}：invalid[{index}] 必須為物件")
            continue
        spec = item.get("spec")
        needle = item.get("reason_contains") or ""
        ok, reason, _rtp = validate_spec(spec)
        if ok:
            errors.append(f"{path}：invalid[{index}] 應失敗卻通過")
        elif needle and needle not in (reason or ""):
            errors.append(f"{path}：invalid[{index}] 原因應含「{needle}」，實際：{reason}")
    return errors


def check_changed_files(path: Path) -> tuple[list[str], list[str]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        return [f"{path}：無法讀取變更清單（{exc}）"], []
    errors: list[str] = []
    warnings: list[str] = []
    game_ids: set[str] = set()
    for raw in lines:
        rel = raw.strip().replace("\\", "/")
        if not rel:
            continue
        if rel == f"{COMMUNITY_PREFIX}index.json":
            continue
        if rel.startswith(COMMUNITY_PREFIX):
            rest = rel[len(COMMUNITY_PREFIX) :]
            folder = rest.split("/", 1)[0]
            if not folder or folder.startswith("_") or "/" not in rest:
                warnings.append(f"{rel}：需要擁有者審核")
                continue
            game_ids.add(folder)
            continue
        warnings.append(f"{rel}：需要擁有者審核")
    if len(game_ids) > 1:
        errors.append("PR 動到多個遊戲（" + "、".join(sorted(game_ids)) + "），每次只能改一個 id")
    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="驗證投稿遊戲")
    parser.add_argument("games_dir", nargs="?", help="site/games/community 目錄")
    parser.add_argument("--vectors", help="規格向量 JSON")
    parser.add_argument("--changed-files", help="變更檔案清單（每行一個路徑）")
    args = parser.parse_args(argv)

    if not args.games_dir and not args.vectors and not args.changed_files:
        parser.print_help()
        return 1

    errors: list[str] = []
    warnings: list[str] = []
    if args.games_dir:
        errors.extend(validate_community(Path(args.games_dir)))
    if args.vectors:
        errors.extend(run_vectors(Path(args.vectors)))
    if args.changed_files:
        changed_errors, changed_warnings = check_changed_files(Path(args.changed_files))
        errors.extend(changed_errors)
        warnings.extend(changed_warnings)

    for warning in warnings:
        sys.stderr.write(f"警告：{warning}\n")
    if errors:
        for error in errors:
            sys.stderr.write(f"錯誤：{error}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
