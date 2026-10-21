#!/usr/bin/env bash
# 一鍵重建：貼圖 → Blender 組裝 → 匯出 GLB / scene.json / .blend
# 需要 Blender 4.5（BLENDER 環境變數可指定路徑）與 Pillow。
set -euo pipefail
cd "$(dirname "$0")"
BLENDER="${BLENDER:-$HOME/tools/blender-4.5.14-linux-x64/blender}"
GAME=../../site/games/community/neon-arcade-street
python3 make_textures.py
python3 fetch_props.py
"$BLENDER" -b -P build_blend.py -- --glb "$GAME/assets/street.glb" --json "$GAME/assets/scene.json" \
  --blend neon-street.blend ${RENDER:+--render "$RENDER"}
