import pathlib
import subprocess

def run(*args):
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
        for line in process.stdout:
            print(line, end='', flush=True)
        if process.wait():
            raise RuntimeError(f'Command failed: {args[0]}')

repo = pathlib.Path('/content/Hunyuan3D-2')
if not repo.exists():
    run('git', 'clone', '--depth', '1', 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git', str(repo))
run('uv', 'pip', 'install', '--python', '/content/phoebe-venv/bin/python',
    'transformers==4.46.3', 'diffusers==0.31.0', 'accelerate==1.1.1',
    'huggingface-hub==0.36.0', 'pymeshlab', 'pygltflib', 'fast-simplification')
print('HUNYUAN_SETUP_COMPLETE', flush=True)
