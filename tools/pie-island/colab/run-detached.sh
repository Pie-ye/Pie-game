#!/usr/bin/env bash
# usage: run-detached.sh <session> <local-script> [args...]   uploads the script and runs it detached on the VM (log: /content/<name>.log)
set -e
s="$1"; f="$2"; shift 2; n=$(basename "$f" .py)
colab upload -s "$s" "$f" "/content/$n.py" >/dev/null
cat > /tmp/launch-$n.py <<EOF
import subprocess
py = 'python3' if '$n'.endswith('setup') or '$n'.startswith(('anima','sdxl','island')) else '/content/phoebe-venv/bin/python'
subprocess.Popen(f"cd /content && nohup {py} -u /content/$n.py $* > /content/$n.log 2>&1 &", shell=True)
print('started $n')
EOF
colab exec -s "$s" --timeout 60 -f /tmp/launch-$n.py 2>&1 | tail -1
