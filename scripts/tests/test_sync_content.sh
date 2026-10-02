#!/usr/bin/env bash
# 用暫存目錄與本機假 remote 驗證 sync_content.sh。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/sync_content.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BARE="$TMP/remote.git"
CLONE="$TMP/content"
LIVE="$TMP/live"
RELEASES="$TMP/releases"

git init --bare --initial-branch=main "$BARE" >/dev/null
git clone "$BARE" "$CLONE" >/dev/null 2>&1
git -C "$CLONE" config user.name tester
git -C "$CLONE" config user.email tester@example.com

write_valid_game() {
  local dest="$1"
  mkdir -p "$dest/tools" "$dest/site/games/community/demo-game"
  cp "$ROOT/tools/validate_games.py" "$dest/tools/validate_games.py"
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

commit_push() {
  local message="$1"
  git -C "$CLONE" add -A
  git -C "$CLONE" commit -m "$message" >/dev/null
  git -C "$CLONE" push origin main >/dev/null 2>&1
}

run_sync() {
  CONTENT_REPO="$CLONE" LIVE_LINK="$LIVE" RELEASES="$RELEASES" bash "$SCRIPT"
}

expect_live() {
  local sha="$1"
  [[ -L "$LIVE" ]]
  local actual
  actual="$(git -C "$LIVE" rev-parse HEAD)"
  [[ "$actual" == "$sha" ]]
}

write_valid_game "$CLONE"
git -C "$CLONE" checkout -B main >/dev/null
commit_push "seed"
SHA1="$(git -C "$CLONE" rev-parse HEAD)"

echo "案例：首次部署"
run_sync
expect_live "$SHA1"
[[ -d "$RELEASES/$SHA1" ]]

echo "案例：無變更"
run_sync
expect_live "$SHA1"
count_after_noop="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | wc -l)"
[[ "$count_after_noop" -eq 1 ]]

echo "案例：fast-forward 更新"
printf '\n' >> "$CLONE/site/games/community/demo-game/README.md"
commit_push "ff"
SHA2="$(git -C "$CLONE" rev-parse HEAD)"
run_sync
expect_live "$SHA2"

echo "案例：非 fast-forward 拒絕"
git -C "$CLONE" reset --hard "$SHA1" >/dev/null
printf '%s\n' 'diverged' >> "$CLONE/site/games/community/demo-game/README.md"
git -C "$CLONE" add -A
git -C "$CLONE" commit -m diverged >/dev/null
git -C "$CLONE" push --force origin main >/dev/null 2>&1
if CONTENT_REPO="$CLONE" LIVE_LINK="$LIVE" RELEASES="$RELEASES" bash "$SCRIPT"; then
  echo "非 fast-forward 應失敗" >&2
  exit 1
fi
expect_live "$SHA2"

git -C "$CLONE" reset --hard "$SHA2" >/dev/null
git -C "$CLONE" push --force origin main >/dev/null 2>&1

echo "案例：驗證失敗不切換"
python3 - "$CLONE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1]) / "site/games/community/demo-game/game.json"
path.write_text("{", encoding="utf-8")
PY
commit_push "bad-json"
if CONTENT_REPO="$CLONE" LIVE_LINK="$LIVE" RELEASES="$RELEASES" bash "$SCRIPT"; then
  echo "驗證失敗應拒絕切換" >&2
  exit 1
fi
expect_live "$SHA2"
# 壞的 commit 不該留下 releases 目錄
BAD_SHA="$(git -C "$CLONE" rev-parse HEAD)"
[[ ! -d "$RELEASES/$BAD_SHA" ]]

git -C "$CLONE" reset --hard "$SHA2" >/dev/null
git -C "$CLONE" push --force origin main >/dev/null 2>&1
write_valid_game "$CLONE"

echo "案例：保留最近 5 份"
for i in 1 2 3 4 5; do
  printf 'release %s\n' "$i" >> "$CLONE/site/games/community/demo-game/README.md"
  commit_push "keep-$i"
  run_sync
done
release_count="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | wc -l)"
if [[ "$release_count" -ne 5 ]]; then
  echo "應保留 5 份，實際 $release_count" >&2
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d >&2
  exit 1
fi
FINAL="$(git -C "$CLONE" rev-parse HEAD)"
expect_live "$FINAL"

echo "test_sync_content.sh 全部通過"
