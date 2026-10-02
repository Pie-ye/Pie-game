#!/usr/bin/env bash
# 把 origin/main 的投稿內容驗證後原子切換到 live 符號連結。
#
# 主機目錄結構（固定）：
#   $CONTENT_ROOT/repo             只追 origin/main 的 clone
#   $CONTENT_ROOT/releases/<sha>   每次發佈的內容（只有 site/games/community 與 site/sdk）
#   $CONTENT_ROOT/live -> releases/<sha>   相對符號連結，首次部署前不存在
#
# 驗證腳本一律用受信任的平台副本（$VALIDATOR），絕不執行剛抓下來的內容裡的
# tools/validate_games.py；git 指令一律關掉 hooks。
set -euo pipefail

CONTENT_ROOT="${CONTENT_ROOT:-$HOME/pie-game-content}"
VALIDATOR="${VALIDATOR:-/home/pieye/Container/Pie-game/tools/validate_games.py}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --content-root)
      CONTENT_ROOT="$2"
      shift 2
      ;;
    --validator)
      VALIDATOR="$2"
      shift 2
      ;;
    *)
      echo "未知參數：$1" >&2
      exit 1
      ;;
  esac
done

expand_tilde() {
  local value="$1"
  if [[ "$value" == ~* ]]; then
    value="${value/#\~/$HOME}"
  fi
  printf '%s\n' "$value"
}

CONTENT_ROOT="$(expand_tilde "$CONTENT_ROOT")"
VALIDATOR="$(expand_tilde "$VALIDATOR")"

REPO="$CONTENT_ROOT/repo"
RELEASES="$CONTENT_ROOT/releases"
LIVE="$CONTENT_ROOT/live"

if [[ ! -d "$REPO/.git" && ! -f "$REPO/.git" ]]; then
  echo "找不到內容 clone：$REPO" >&2
  exit 1
fi
if [[ ! -f "$VALIDATOR" ]]; then
  echo "找不到受信任的驗證腳本：$VALIDATOR" >&2
  exit 1
fi

# 投稿內容是不受信任的輸入：hooks 一律關掉，免得惡意 PR 夾帶 git hook 拿到主機權限。
git_content() {
  git -c core.hooksPath=/dev/null -C "$REPO" "$@"
}

mkdir -p "$RELEASES"
LOCK="$CONTENT_ROOT/.sync.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "已有同步程序在跑，略過"
  exit 0
fi

STAGE=""
cleanup() {
  if [[ -n "$STAGE" && -d "$STAGE" ]]; then
    rm -rf "$STAGE"
  fi
}
trap cleanup EXIT

git_content fetch origin main
NEW_SHA="$(git_content rev-parse origin/main)"

if [[ -L "$LIVE" ]]; then
  CURRENT_SHA="$(basename "$(readlink "$LIVE")")"
  if [[ "$CURRENT_SHA" == "$NEW_SHA" ]]; then
    echo "已是最新 $NEW_SHA"
    exit 0
  fi
  if ! git_content merge-base --is-ancestor "$CURRENT_SHA" "$NEW_SHA"; then
    echo "非 fast-forward，拒絕更新（live=$CURRENT_SHA origin/main=$NEW_SHA）" >&2
    exit 1
  fi
fi

if [[ -d "$RELEASES/$NEW_SHA" ]]; then
  rm -rf "$RELEASES/$NEW_SHA"
fi

# 只取要上線的兩個目錄，不展開整個 worktree（tools/、server/ 都不該出現在內容裡）。
STAGE="$RELEASES/.staging-$NEW_SHA.$$"
mkdir -p "$STAGE/site"
if ! git_content archive --format=tar origin/main site/games/community site/sdk \
  | tar -x -f - -C "$STAGE"; then
  echo "無法取出內容（site/games/community 或 site/sdk 不存在？）" >&2
  exit 1
fi

# 符號連結一律拒絕：唯讀 bind mount 裡的連結仍會在容器內被解析，可能指向映像裡的檔案。
if [[ -n "$(find "$STAGE" -type l -print -quit)" ]]; then
  echo "內容含符號連結，拒絕發佈：" >&2
  find "$STAGE" -type l >&2
  exit 1
fi

if ! python3 "$VALIDATOR" "$STAGE/site/games/community"; then
  echo "驗證失敗，不切換 live" >&2
  exit 1
fi

mv "$STAGE" "$RELEASES/$NEW_SHA"
STAGE=""

# 相對連結＋rename 換上去：切換是原子的，容器下一個請求就會解析到新的 releases/<sha>。
PENDING="$CONTENT_ROOT/.live.new"
rm -f "$PENDING"
ln -s "releases/$NEW_SHA" "$PENDING"
mv -Tf "$PENDING" "$LIVE"
echo "live → $NEW_SHA"

mapfile -t DIRS < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
kept=0
for dir in "${DIRS[@]}"; do
  if [[ "$(basename "$dir")" == "$NEW_SHA" ]]; then
    continue
  fi
  kept=$((kept + 1))
  if [[ "$kept" -gt "$KEEP_RELEASES" ]]; then
    rm -rf "$dir"
  fi
done
