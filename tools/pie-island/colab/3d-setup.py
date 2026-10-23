"""Hunyuan3D-2 environment on a Colab GPU (python 3.11 venv, torch cu124). Paint extensions only when the GPU is an L4/A100 (RAM)."""
import os, pathlib, subprocess, sys, shutil, glob
def run(cmd, **kw):
    print('+', cmd, flush=True)
    p = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **kw)
    for line in p.stdout: print(line, end='', flush=True)
    if p.wait(): raise RuntimeError('failed: ' + cmd)
py = '/content/phoebe-venv/bin/python'
if not shutil.which('uv'): run(f'{sys.executable} -m pip install -q uv')
if not pathlib.Path(py).exists(): run('uv venv --python 3.11 --seed /content/phoebe-venv')
run(f'uv pip install --python {py} torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124')
run(f'uv pip install --python {py} omegaconf==2.3.0 einops==0.7.0 transformers==4.46.3 diffusers==0.31.0 accelerate==1.1.1 huggingface-hub==0.36.0 trimesh>=4.4 numpy==1.26.4 '
    'rembg==2.0.57 "opencv-python-headless<4.12" onnxruntime imageio[ffmpeg] xatlas ninja cmake wheel "setuptools<70" pybind11 pymeshlab pygltflib fast-simplification scikit-image scipy pillow')
if not pathlib.Path('/content/Hunyuan3D-2').exists(): run('git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git /content/Hunyuan3D-2')
print('SHAPE_ENV_COMPLETE', flush=True)
if os.environ.get('PAINT') == '1' or 'L4' in subprocess.check_output(['nvidia-smi','--query-gpu=name','--format=csv,noheader'], text=True):
    run(f'uv pip install --python {py} realesrgan basicsr-fixed gfpgan facexlib')
    run('cd /content && (test -x bin/micromamba || (curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj bin/micromamba))')
    run('rm -rf /content/cuda124; /content/bin/micromamba create -y -q -p /content/cuda124 -c nvidia/label/cuda-12.4.1 -c conda-forge cuda-nvcc cuda-cudart-dev cuda-libraries-dev cuda-nvrtc-dev 2>&1 | tail -5')
    home = pathlib.Path('/content/cuda124')
    env = dict(os.environ, CUDA_HOME=str(home), PATH=f'{home}/bin:' + os.environ['PATH'], TORCH_CUDA_ARCH_LIST=subprocess.check_output(['nvidia-smi','--query-gpu=compute_cap','--format=csv,noheader'],text=True).split()[0], CPATH=f'{home}/include:{home}/targets/x86_64-linux/include', LIBRARY_PATH=f'{home}/lib:{home}/targets/x86_64-linux/lib')
    repo = '/content/Hunyuan3D-2/hy3dgen/texgen'
    run(f'cd {repo}/custom_rasterizer && {py} setup.py install', env=env)
    run(f'cd {repo}/differentiable_renderer && {py} setup.py install', env=env)
    print('PAINT_SETUP_COMPLETE', flush=True)
print('3D_SETUP_COMPLETE', flush=True)
