#!/usr/bin/env bash
# 用暫存目錄與本機假 remote 驗證 sync_content.sh。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/sync_content.sh"
VALIDATOR="$ROOT/tools/validate_games.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BARE="$TMP/remote.git"
CONTENT_ROOT="$TMP/pie-game-content"
REPO="$CONTENT_ROOT/repo"
RELEASES="$CONTENT_ROOT/releases"
LIVE="$CONTENT_ROOT/live"
PWNED="$TMP/pwned"

mkdir -p "$CONTENT_ROOT"
git init --bare --initial-branch=main "$BARE" >/dev/null
git clone "$BARE" "$REPO" >/dev/null 2>&1
git -C "$REPO" config user.name tester
git -C "$REPO" config user.email tester@example.com

write_valid_game() {
  local dest="$1"
  mkdir -p "$dest/site/sdk" "$dest/site/games/community/demo-game"
  printf '%s\n' '// sdk' > "$dest/site/sdk/pie-game-sdk.js"
  cat > "$dest/site/games/community/index.json" <<'JSON'
{"games": ["demo-game"]}
JSON
  cat > "$dest/site/games/community/demo-game/game.json" <<'JSON'
{
  "id": "demo-game",
  "name": "測試",
  "kind": "free",
  "multiplayer": false,
  "author": "tester",
  "entry": "index.html",
  "description": "同步測試",
  "tags": ["test"]
}
JSON
  printf '%s\n' '<!DOCTYPE html><title>ok</title>' > "$dest/site/games/community/demo-game/index.html"
  printf '%s\n' '# demo' > "$dest/site/games/community/demo-game/README.md"
}

# 內容 repo 裡夾帶的驗證腳本：只要被執行就會留下記號並放行任何內容。
write_hostile_validator() {
  local dest="$1"
  mkdir -p "$dest/tools"
  cat > "$dest/tools/validate_games.py" <<PY
import pathlib
import sys

pathlib.Path("$PWNED").write_text("executed", encoding="utf-8")
sys.exit(0)
PY
}

commit_push() {
  local message="$1"
  git -C "$REPO" add -A
  git -C "$REPO" commit -m "$message" >/dev/null
  git -C "$REPO" push origin main >/dev/null 2>&1
}

run_sync() {
  CONTENT_ROOT="$CONTENT_ROOT" VALIDATOR="$VALIDATOR" bash "$SCRIPT"
}

expect_live() {
  local sha="$1"
  [[ -L "$LIVE" ]]
  # live 必須是相對連結，否則容器裡解析不到。
  local target
  target="$(readlink "$LIVE")"
  [[ "$target" == "releases/$sha" ]]
  [[ -d "$LIVE/site/games/community" ]]
}

write_valid_game "$REPO"
write_hostile_validator "$REPO"
git -C "$REPO" checkout -B main >/dev/null
commit_push "seed"
SHA1="$(git -C "$REPO" rev-parse HEAD)"

echo "案例：首次部署（live 原本不存在）"
[[ ! -e "$LIVE" ]]
run_sync
expect_live "$SHA1"
[[ -d "$RELEASES/$SHA1/site/games/community/demo-game" ]]
[[ -f "$RELEASES/$SHA1/site/sdk/pie-game-sdk.js" ]]

echo "案例：只發佈投稿內容，不含 tools/"
[[ ! -e "$RELEASES/$SHA1/tools" ]]
[[ ! -e "$PWNED" ]]

echo "案例：無變更"
run_sync
expect_live "$SHA1"
count_after_noop="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | wc -l)"
[[ "$count_after_noop" -eq 1 ]]

echo "案例：fast-forward 更新"
printf '\n' >> "$REPO/site/games/community/demo-game/README.md"
commit_push "ff"
SHA2="$(git -C "$REPO" rev-parse HEAD)"
run_sync
expect_live "$SHA2"

echo "案例：live 目標被刪掉仍做 fast-forward 檢查"
rm -rf "$RELEASES/$SHA2"
[[ -L "$LIVE" ]]
printf 'dangle\n' >> "$REPO/site/games/community/demo-game/README.md"
commit_push "dangle"
SHA2="$(git -C "$REPO" rev-parse HEAD)"
run_sync
expect_live "$SHA2"

echo "案例：非 fast-forward 拒絕"
git -C "$REPO" reset --hard "$SHA1" >/dev/null
printf '%s\n' 'diverged' >> "$REPO/site/games/community/demo-game/README.md"
git -C "$REPO" add -A
git -C "$REPO" commit -m diverged >/dev/null
git -C "$REPO" push --force origin main >/dev/null 2>&1
if run_sync; then
  echo "非 fast-forward 應失敗" >&2
  exit 1
fi
expect_live "$SHA2"

git -C "$REPO" reset --hard "$SHA2" >/dev/null
git -C "$REPO" push --force origin main >/dev/null 2>&1

echo "案例：驗證失敗不切換，也不執行內容裡的驗證腳本"
python3 - "$REPO" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1]) / "site/games/community/demo-game/game.json"
path.write_text("{", encoding="utf-8")
PY
commit_push "bad-json"
if run_sync; then
  echo "驗證失敗應拒絕切換" >&2
  exit 1
fi
expect_live "$SHA2"
BAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
[[ ! -d "$RELEASES/$BAD_SHA" ]]
[[ -z "$(find "$RELEASES" -mindepth 1 -maxdepth 1 -name '.staging-*')" ]]
[[ ! -e "$PWNED" ]]

git -C "$REPO" reset --hard "$SHA2" >/dev/null
git -C "$REPO" push --force origin main >/dev/null 2>&1

echo "案例：內容含符號連結就拒絕發佈"
ln -s ../../../../../etc/passwd "$REPO/site/games/community/demo-game/leak.txt"
commit_push "symlink"
if run_sync; then
  echo "符號連結應讓發佈失敗" >&2
  exit 1
fi
expect_live "$SHA2"
LINK_SHA="$(git -C "$REPO" rev-parse HEAD)"
[[ ! -d "$RELEASES/$LINK_SHA" ]]

git -C "$REPO" reset --hard "$SHA2" >/dev/null
git -C "$REPO" push --force origin main >/dev/null 2>&1
rm -f "$REPO/site/games/community/demo-game/leak.txt"

echo "案例：保留最近 5 份（live 不佔名額）"
for i in 1 2 3 4 5; do
  printf 'release %s\n' "$i" >> "$REPO/site/games/community/demo-game/README.md"
  commit_push "keep-$i"
  run_sync
done
release_count="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | wc -l)"
# live 一份 + 另外 5 份歷史 = 6
if [[ "$release_count" -ne 6 ]]; then
  echo "應保留 live+5 共 6 份，實際 $release_count" >&2
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d >&2
  exit 1
fi
FINAL="$(git -C "$REPO" rev-parse HEAD)"
expect_live "$FINAL"

echo "案例：切換 live 後，同一個路徑立刻讀到另一份 release"
README_THROUGH_LIVE="$LIVE/site/games/community/demo-game/README.md"
before="$(cat "$README_THROUGH_LIVE")"
PREVIOUS="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name "$FINAL" -printf '%f\n' | head -n1)"
ln -s "releases/$PREVIOUS" "$CONTENT_ROOT/.live.new"
mv -Tf "$CONTENT_ROOT/.live.new" "$LIVE"
after="$(cat "$README_THROUGH_LIVE")"
if [[ "$before" == "$after" ]]; then
  echo "切換 live 後讀到的內容應該不同" >&2
  exit 1
fi
expect_live "$PREVIOUS"

echo "test_sync_content.sh 全部通過"
