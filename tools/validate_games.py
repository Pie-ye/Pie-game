#!/usr/bin/env python3
"""驗證投稿遊戲目錄、game.json、金幣規格與 PR 變更範圍。

validate_spec 與 rtp_for_bet 整段複製自股票大亂鬥 server/casino/community.py。
上游 commit：12cdc18a867a34ebf74e881e259698ecacceb82e
（fix(casino): 修正 S2 第二輪審核 findings）
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

# --- 以下常數與 validate_spec／rtp_for_bet 與股票大亂鬥 community.py 相同 ---
MAX_FILE_BYTES = 64 * 1024  # 單檔與整份規格上限 64 KB
MAX_DISPLAY_ITEM_BYTES = 2 * 1024  # display 單項上限 2 KB
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}$")


def rtp_for_bet(
    choice: dict[str, Any],
    bet: int,
    parsed_outcomes: list[tuple[int, Fraction]] | None = None,
) -> Fraction:
    """單一選項在指定押注金額下的實際回饋率。

    用實際派彩 floor(bet × return) 計算，因為金幣帳本只能記整數，
    回傳 Fraction 而非 float 是為了讓驗證與測試能做精確比較、不受浮點誤差影響。
    `parsed_outcomes` 是 (weight, return) 的預先解析結果：驗證時逐注重算會問上百次，
    傳進來就不必每次重新 parse Fraction。
    """
    pairs = parsed_outcomes
    if pairs is None:
        pairs = [(o["weight"], Fraction(o["return"])) for o in choice["outcomes"]]
    total_weight = 0
    total_payout = 0
    for weight, ret_frac in pairs:
        total_weight += weight
        total_payout += weight * ((bet * ret_frac.numerator) // ret_frac.denominator)
    return Fraction(total_payout, total_weight * bet)


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

            # display（可選）：若出現則必須為 list，長度 1–32，每項任意 JSON，序列化後單項 ≤ 2 KB
            if "display" in outcome:
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

        # 9. 期望值驗證：名目 RTP = Σ(weight × return) / Σweight 必須 ≤ 98/100
        sum_weight = sum(w for w, _ in parsed_outcomes)

        # 標稱 RTP
        nominal_rtp = sum(w * rf for w, rf in parsed_outcomes) / sum_weight
        if nominal_rtp > max_rtp_fraction:
            return False, f"選項 '{cid}' 期望回饋率超過 98%（{float(nominal_rtp):.4f}）", {}

        # 防禦性檢查：floor 只會降低派彩，數學上不會擋下名目檢查已放行的規格；
        # 保留是為了將來若改用非 floor 的捨入規則時仍安全。
        for bet in range(min_bet, max_bet + 1):
            bet_rtp = rtp_for_bet(choice, bet, parsed_outcomes=parsed_outcomes)
            if bet_rtp > max_rtp_fraction:
                return False, f"選項 '{cid}' 在押注 {bet} 時回饋率超過 98%（{float(bet_rtp):.4f}）", {}

        rtp_by_choice[cid] = float(nominal_rtp)

    return True, None, rtp_by_choice

# --- 投稿目錄規則 ---
GAME_FILE_MAX_BYTES = 25 * 1024 * 1024  # 25 MiB
GAME_TOTAL_MAX_BYTES = 50_000_000  # 50 MB
MAX_INDEX_GAMES = 200  # index.json 最多列 200 個遊戲
TEMPLATE_PREFIX = "_template-"
REQUIRED_GAME_FIELDS = ("id", "name", "kind", "multiplayer", "author", "entry", "description", "tags")
ATTR_RE = re.compile(
    r'(?P<attr>srcset|src|href|poster)\s*=\s*(?:(?P<q>["\'])(?P<quoted>.*?)(?P=q)|(?P<bare>[^\s>]+))',
    re.IGNORECASE | re.DOTALL,
)
URL_FN_RE = re.compile(r'url\(\s*(?P<q>["\']?)(?P<url>.*?)(?P=q)\s*\)', re.IGNORECASE | re.DOTALL)
IMPORT_RE = re.compile(
    r'''@import\s+(?:url\s*\(\s*)?(?:["']?)(?P<url>(?:https?:)?//[^"')\s]+)''',
    re.IGNORECASE,
)
A_TAG_RE = re.compile(r"<a\b([^>]*)>", re.IGNORECASE | re.DOTALL)
META_TAG_RE = re.compile(r"<meta\b([^>]*)/?>", re.IGNORECASE | re.DOTALL)
HREF_IN_ATTRS_RE = re.compile(
    r'''\bhref\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))''',
    re.IGNORECASE | re.DOTALL,
)
COMMUNITY_PREFIX = "site/games/community/"


def _is_external_url(url: str) -> bool:
    stripped = url.strip()
    return stripped.startswith("http://") or stripped.startswith("https://") or stripped.startswith("//")


def _rel_has_noopener(attrs: str) -> bool:
    match = re.search(r'''\brel\s*=\s*(['"])(.*?)\1''', attrs, re.IGNORECASE | re.DOTALL)
    if match is None:
        match = re.search(r'''\brel\s*=\s*([^\s>]+)''', attrs, re.IGNORECASE)
        if match is None:
            return False
        tokens = re.split(r"\s+", match.group(1).lower())
        return "noopener" in tokens
    tokens = re.split(r"\s+", match.group(2).lower())
    return "noopener" in tokens


def _line_at(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def _attr_value(match: re.Match[str]) -> str:
    quoted = match.group("quoted")
    if quoted is not None:
        return quoted.strip()
    return (match.group("bare") or "").strip()


def _urls_from_attr(attr: str, value: str) -> list[str]:
    if attr.lower() == "srcset":
        urls: list[str] = []
        for part in value.split(","):
            token = part.strip().split(None, 1)[0] if part.strip() else ""
            if token:
                urls.append(token)
        return urls
    return [value]


def _inside_anchor(text: str, index: int) -> bool:
    before = text[:index]
    last_lt = before.rfind("<")
    last_gt = before.rfind(">")
    return last_lt > last_gt and re.match(r"<a\b", text[last_lt:index + 8], re.IGNORECASE) is not None


def check_external_resources(path: Path, text: str) -> list[str]:
    """HTML／CSS 不得載入外部資源；<a href> 外連必須 rel=noopener。"""
    errors: list[str] = []
    rel = str(path)

    for match in A_TAG_RE.finditer(text):
        attrs = match.group(1)
        href_match = HREF_IN_ATTRS_RE.search(attrs)
        if href_match is None:
            continue
        url = (href_match.group(2) if href_match.group(2) is not None else href_match.group(3) or "").strip()
        if _is_external_url(url) and not _rel_has_noopener(attrs):
            errors.append(f"{rel}:{_line_at(text, match.start())}：外連 <a href> 必須加上 rel=\"noopener\"")

    for match in ATTR_RE.finditer(text):
        attr = match.group("attr").lower()
        value = _attr_value(match)
        if attr == "href" and _inside_anchor(text, match.start()):
            continue
        for url in _urls_from_attr(attr, value):
            if _is_external_url(url):
                errors.append(f"{rel}:{_line_at(text, match.start())}：不得引用外部網址（{attr}={url[:80]}）")

    for match in URL_FN_RE.finditer(text):
        url = match.group("url").strip()
        if _is_external_url(url):
            errors.append(f"{rel}:{_line_at(text, match.start())}：不得引用外部網址（url({url[:80]})）")

    for match in IMPORT_RE.finditer(text):
        url = match.group("url").strip()
        if _is_external_url(url):
            errors.append(f"{rel}:{_line_at(text, match.start())}：不得引用外部網址（@import {url[:80]}）")

    for match in META_TAG_RE.finditer(text):
        attrs = match.group(1)
        if not re.search(r'''http-equiv\s*=\s*(["']?)refresh\1''', attrs, re.IGNORECASE):
            continue
        content_match = re.search(
            r'''\bcontent\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))''',
            attrs,
            re.IGNORECASE | re.DOTALL,
        )
        if content_match is None:
            continue
        content = content_match.group(2) if content_match.group(2) is not None else content_match.group(3) or ""
        url_match = re.search(r'''url\s*=\s*([^\s;"']+)''', content, re.IGNORECASE)
        if url_match and _is_external_url(url_match.group(1).strip()):
            errors.append(
                f"{rel}:{_line_at(text, match.start())}：不得引用外部網址（meta refresh={url_match.group(1).strip()[:80]}）"
            )
    return errors

def _iter_files(root: Path) -> tuple[list[Path], list[str]]:
    """走訪投稿目錄，回傳 (一般檔案清單, 符號連結錯誤)。

    符號連結一律拒絕：唯讀掛進容器後連結仍會在容器內被解析，可能讀到映像裡的
    平台檔案；驗證階段也會被連結騙過大小與外部網址檢查。
    """
    files: list[Path] = []
    errors: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        here = Path(dirpath)
        dirnames[:] = [name for name in dirnames if name != ".git"]
        for name in list(dirnames):
            if (here / name).is_symlink():
                errors.append(f"{here / name}：不可使用符號連結")
                dirnames.remove(name)
        for name in filenames:
            path = here / name
            if path.is_symlink():
                errors.append(f"{path}：不可使用符號連結")
                continue
            files.append(path)
    return files, errors


def _load_json(path: Path) -> tuple[Any, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except FileNotFoundError:
        return None, f"{path}：檔案不存在"
    except UnicodeDecodeError:
        return None, f"{path}：不是 UTF-8 文字"
    except json.JSONDecodeError as exc:
        return None, f"{path}：JSON 無法解析（{exc}）"


def validate_game_dir(game_dir: Path, *, template: bool = False) -> list[str]:
    """驗證一個投稿目錄。

    `template` 為範本目錄（`_template-*`）：資料夾名稱不是 id、也不必列進
    index.json，其餘規則（game.json 欄位、規格、外部網址、檔案大小、符號連結）
    與投稿完全相同。
    """
    errors: list[str] = []
    game_id = game_dir.name
    game_json_path = game_dir / "game.json"
    readme_path = game_dir / "README.md"

    if not template and not ID_PATTERN.fullmatch(game_id):
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
    elif not template and gid != game_id:
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
    files, symlink_errors = _iter_files(game_dir)
    errors.extend(symlink_errors)
    for file_path in files:
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
    if len(games) > MAX_INDEX_GAMES:
        return [], f"index.json 的 games 最多 {MAX_INDEX_GAMES} 個（目前 {len(games)}）"
    ids: list[str] = []
    for item in games:
        # 上游（股票大亂鬥）只吃字串 id，這裡不能更寬鬆。
        if not isinstance(item, str):
            return [], "index.json 的 games 必須是字串 id 陣列"
        ids.append(item)
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

    disk_ids: list[str] = []
    template_ids: list[str] = []
    for path in sorted(root.iterdir()):
        if path.is_symlink():
            errors.append(f"{path}：不可使用符號連結")
            continue
        if not path.is_dir():
            continue
        if path.name.startswith(TEMPLATE_PREFIX):
            template_ids.append(path.name)
        elif path.name.startswith("_"):
            errors.append(f"{path}：底線開頭的資料夾名稱保留給 {TEMPLATE_PREFIX}* 範本")
        else:
            disk_ids.append(path.name)

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
    for template_id in template_ids:
        errors.extend(validate_game_dir(root / template_id, template=True))
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


def is_owner_pr(pr_author: str | None, repo_owner: str | None) -> bool:
    """作者是否為 repo 擁有者。兩者任一不明（本機執行）時當成擁有者，只出警告。"""
    if not pr_author or not repo_owner:
        return True
    return pr_author.strip().lower() == repo_owner.strip().lower()


def check_changed_files(
    path: Path,
    *,
    pr_author: str | None = None,
    repo_owner: str | None = None,
) -> tuple[list[str], list[str]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        return [f"{path}：無法讀取變更清單（{exc}）"], []
    errors: list[str] = []
    warnings: list[str] = []
    game_ids: set[str] = set()
    outside: list[str] = []
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
                outside.append(rel)
                continue
            game_ids.add(folder)
            continue
        outside.append(rel)

    # 投稿者改到平台路徑一律失敗；擁有者自己的 PR 只標示需要審核。
    if is_owner_pr(pr_author, repo_owner):
        warnings.extend(f"{rel}：需要擁有者審核" for rel in outside)
    else:
        errors.extend(
            f"{rel}：投稿 PR 只能改 {COMMUNITY_PREFIX}<自己的 id>/ 與 {COMMUNITY_PREFIX}index.json"
            for rel in outside
        )
    if len(game_ids) > 1:
        errors.append("PR 動到多個遊戲（" + "、".join(sorted(game_ids)) + "），每次只能改一個 id")
    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="驗證投稿遊戲")
    parser.add_argument("games_dir", nargs="?", help="site/games/community 目錄")
    parser.add_argument("--vectors", help="規格向量 JSON")
    parser.add_argument("--changed-files", help="變更檔案清單（每行一個路徑）")
    parser.add_argument("--pr-author", help="PR 作者的 GitHub 帳號")
    parser.add_argument("--repo-owner", help="repo 擁有者的 GitHub 帳號")
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
        changed_errors, changed_warnings = check_changed_files(
            Path(args.changed_files),
            pr_author=args.pr_author,
            repo_owner=args.repo_owner,
        )
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
