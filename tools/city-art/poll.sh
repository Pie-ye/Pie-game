#!/usr/bin/env bash
# usage: poll.sh <session> <remote-dir> <local-dir> <jobs.json> [interval]
# 每隔一陣子把工作階段上新產出的圖抓回來：Colab 工作階段會被無預警回收，產出一定要即時下載。
s="$1"; rd="$2"; d="$3"; job="$4"; iv="${5:-60}"; mkdir -p "$d"
while true; do
  python3 - "$job" <<'PY' | while read -r f; do
import json, sys
j = json.load(open(sys.argv[1]))
for it in j['items']:
    for seed in it.get('seeds', [1, 2]):
        print(f"{it['name']}_{seed}.png")
        print(f"{it['name']}_{seed}_cut.png")
PY
    [ -s "$d/$f" ] || colab download -s "$s" "$rd/$f" "$d/$f" >/dev/null 2>&1
  done
  sleep "$iv"
done
