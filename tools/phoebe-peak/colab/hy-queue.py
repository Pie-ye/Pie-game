"""Run on the VM (system python): wait for a log marker, copy chosen reference images into /content/refs, then run hy-textured.py (venv) on them.
usage: python3 hy-queue.py jobs.json [--after LOG MARKER]     jobs.json: {"PAINT_SUB":"...","refs":{"name":"/content/env_out/x_1.png",...}}"""
import json, os, shutil, subprocess, sys, time
spec = json.load(open(sys.argv[1]))
if '--after' in sys.argv:
    log, marker = sys.argv[sys.argv.index('--after') + 1:sys.argv.index('--after') + 3]
    while not (os.path.exists(log) and marker in open(log, errors='replace').read()): time.sleep(10)
os.makedirs('/content/refs', exist_ok=True)
for name, src in spec['refs'].items():
    if os.path.exists(src): shutil.copy(src, f'/content/refs/{name}.png')
    else: print('MISSING', src, flush=True)
env = dict(os.environ, PAINT_SUB=spec.get('PAINT_SUB', 'hunyuan3d-paint-v2-0-turbo'))
subprocess.run(['/content/phoebe-venv/bin/python', '-u', '/content/hy-textured.py', *spec['refs'].keys()], env=env)
print('QUEUE_DONE', flush=True)
