"""Run with colab exec -s phoebe-3d -f tools/phoebe-egg/colab-setup.py."""
import pathlib
import subprocess
import sys
import shutil

def run(*args):
    print('Running:', ' '.join(args), flush=True)
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
        for line in process.stdout:
            print(line, end='', flush=True)
        if process.wait():
            raise RuntimeError(f'Command failed: {args[0]}')

run('nvidia-smi')
repo = pathlib.Path('/content/TripoSR')
if not repo.exists():
    run('git', 'clone', '--depth', '1', 'https://github.com/VAST-AI-Research/TripoSR.git', str(repo))
if not shutil.which('uv'):
    run(sys.executable, '-m', 'pip', 'install', 'uv')
if not pathlib.Path('/content/phoebe-venv/bin/python').exists():
    run('uv', 'venv', '--python', '3.11', '--seed', '/content/phoebe-venv')
python = '/content/phoebe-venv/bin/python'
run('uv', 'pip', 'install', '--python', python, 'torch==2.5.1', 'torchvision==0.20.1',
    '--index-url', 'https://download.pytorch.org/whl/cu124')
run('uv', 'pip', 'install', '--python', python, 'omegaconf==2.3.0', 'einops==0.7.0',
    'transformers==4.35.0', 'huggingface-hub<1', 'trimesh>=4.4', 'numpy==1.26.4',
    'rembg==2.0.57', 'opencv-python-headless<4.12', 'onnxruntime',
    'imageio[ffmpeg]', 'xatlas', 'moderngl', 'ninja', 'cmake', 'wheel', 'setuptools',
    'scikit-build-core', 'pybind11')
# Mesh extraction uses scikit-image on CPU; model inference remains on CUDA.
# Avoid compiling torchmcubes against Colab's changing system CUDA toolkit.
print('TRIPOSR_SETUP_COMPLETE', flush=True)
