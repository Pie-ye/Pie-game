#!/usr/bin/env bash
# usage: fetch.sh <session> <local-dir> <jobs.json> [...]   下載 jobs 裡每個 name×seed 的圖（含 _cut 版本），已存在就略過。
# 用 colab download（檔案 API）而不是 exec：VM 忙的時候 exec 常常逾時。
set -u
s="$1"; d="$2"; shift 2; mkdir -p "$d"
for job in "$@"; do
  python3 - "$job" <<'PY' | while read -r f; do
import json, sys
for it in json.load(open(sys.argv[1]))['items']:
    for seed in it.get('seeds', [1, 2]):
        print(f"{it['name']}_{seed}.png")
        if it.get('cut'): print(f"{it['name']}_{seed}_cut.png")
PY
    [ -s "$d/$f" ] && continue
    colab download -s "$s" "/content/city_out/$f" "$d/$f" >/dev/null 2>&1 && echo "got $f"
  done
done
