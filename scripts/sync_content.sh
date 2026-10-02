#!/usr/bin/env bash
# 把 pie-game-content 的 origin/main 驗證後原子切換到 live 符號連結。
set -euo pipefail

CONTENT_REPO="${CONTENT_REPO:-$HOME/pie-game-content}"
LIVE_LINK="${LIVE_LINK:-$HOME/pie-game-content-live}"
RELEASES="${RELEASES:-$HOME/pie-game-content-releases}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --content-repo)
      CONTENT_REPO="$2"
      shift 2
      ;;
    --live-link)
      LIVE_LINK="$2"
      shift 2
      ;;
    --releases)
      RELEASES="$2"
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

CONTENT_REPO="$(expand_tilde "$CONTENT_REPO")"
LIVE_LINK="$(expand_tilde "$LIVE_LINK")"
RELEASES="$(expand_tilde "$RELEASES")"

if [[ ! -d "$CONTENT_REPO/.git" && ! -f "$CONTENT_REPO/.git" ]]; then
  echo "CONTENT_REPO 不是 git 工作樹：$CONTENT_REPO" >&2
  exit 1
fi

mkdir -p "$RELEASES"
LOCK="$CONTENT_REPO/.pie-game-content-sync.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "已有同步程序在跑，略過"
  exit 0
fi

git -C "$CONTENT_REPO" fetch origin main
NEW_SHA="$(git -C "$CONTENT_REPO" rev-parse origin/main)"
CURRENT_SHA=""
if [[ -e "$LIVE_LINK" ]]; then
  CURRENT_SHA="$(git -C "$LIVE_LINK" rev-parse HEAD)"
  if [[ "$CURRENT_SHA" == "$NEW_SHA" ]]; then
    echo "已是最新 $NEW_SHA"
    exit 0
  fi
  if ! git -C "$CONTENT_REPO" merge-base --is-ancestor "$CURRENT_SHA" "$NEW_SHA"; then
    echo "非 fast-forward，拒絕更新（live=$CURRENT_SHA origin/main=$NEW_SHA）" >&2
    exit 1
  fi
fi

NEW_DIR="$RELEASES/$NEW_SHA"
if [[ ! -d "$NEW_DIR" ]]; then
  git -C "$CONTENT_REPO" worktree add --detach "$NEW_DIR" origin/main
fi

VALIDATOR="$NEW_DIR/tools/validate_games.py"
GAMES_DIR="$NEW_DIR/site/games/community"
if [[ ! -f "$VALIDATOR" ]]; then
  echo "驗證失敗：找不到 $VALIDATOR" >&2
  git -C "$CONTENT_REPO" worktree remove --force "$NEW_DIR" || rm -rf "$NEW_DIR"
  exit 1
fi

if ! python3 "$VALIDATOR" "$GAMES_DIR"; then
  echo "驗證失敗，不切換 live" >&2
  git -C "$CONTENT_REPO" worktree remove --force "$NEW_DIR" || rm -rf "$NEW_DIR"
  exit 1
fi

ln -sfn "$NEW_DIR" "$LIVE_LINK"
echo "live → $NEW_SHA"

mapfile -t DIRS < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
LIVE_TARGET="$(readlink -f "$LIVE_LINK" || true)"
kept=0
for dir in "${DIRS[@]}"; do
  kept=$((kept + 1))
  if [[ "$kept" -gt 5 && "$dir" != "$LIVE_TARGET" ]]; then
    git -C "$CONTENT_REPO" worktree remove --force "$dir" || rm -rf "$dir"
  fi
done
