#!/usr/bin/env bash
# usage: upload-lora.sh <session> <local.safetensors> <remote-dir>   (split into 20 MB parts: single large uploads time out)
set -e
s="$1"; f="$2"; d="$3"; n=$(basename "$f"); t=$(mktemp -d)
split -b 20971520 -d -a 2 "$f" "$t/part_"
colab exec -s "$s" --timeout 30 -f <(echo "import os; os.makedirs('/content/parts_$n',exist_ok=True); os.makedirs('$d',exist_ok=True)") >/dev/null
for p in "$t"/part_*; do colab upload -s "$s" "$p" "/content/parts_$n/$(basename $p)" >/dev/null; echo -n .; done; echo
colab exec -s "$s" --timeout 60 -f <(echo "import subprocess;print(subprocess.run('cat /content/parts_$n/part_* > $d/$n && ls -l $d/$n && python3 -c \"import hashlib;print(hashlib.sha256(open(\\\"$d/$n\\\",\\\"rb\\\").read()).hexdigest())\"',shell=True,capture_output=True,text=True).stdout)") 2>&1 | tail -3
sha256sum "$f" | cut -c1-64
rm -rf "$t"
