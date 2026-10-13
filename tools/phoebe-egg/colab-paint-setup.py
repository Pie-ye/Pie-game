"""Install Hunyuan3D-2 texture (paint) dependencies on the Colab T4.
Colab ships CUDA 13 nvcc but our torch is cu124, so build the two CUDA
extensions against a pip-provided CUDA 12.4 toolchain."""
import os, pathlib, subprocess, sys, glob

def run(cmd, **kw):
    print('+', cmd, flush=True)
    p = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **kw)
    for line in p.stdout: print(line, end='', flush=True)
    if p.wait(): raise RuntimeError('failed: ' + cmd)

py = '/content/phoebe-venv/bin/python'
run(f'uv pip install --python {py} '
    '\"opencv-python-headless<4.12\" pybind11 ninja xatlas trimesh pygltflib pymeshlab scikit-image einops omegaconf==2.3.0 '
    'diffusers==0.31.0 transformers==4.46.3 accelerate==1.1.1 huggingface-hub==0.36.0 realesrgan basicsr-fixed gfpgan facexlib numpy==1.26.4 \"setuptools<70\" wheel')
run('cd /content && (test -x bin/micromamba || (curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj bin/micromamba))')
run('rm -rf /content/cuda124; /content/bin/micromamba create -y -q -p /content/cuda124 -c nvidia/label/cuda-12.4.1 -c conda-forge cuda-nvcc cuda-cudart-dev cuda-libraries-dev cuda-nvrtc-dev 2>&1 | tail -5')
home = pathlib.Path('/content/cuda124')
env = dict(os.environ, CUDA_HOME=str(home), PATH=f'{home}/bin:' + os.environ['PATH'], TORCH_CUDA_ARCH_LIST=subprocess.check_output(['nvidia-smi','--query-gpu=compute_cap','--format=csv,noheader'],text=True).split()[0], CPATH=f'{home}/include:{home}/targets/x86_64-linux/include', LIBRARY_PATH=f'{home}/lib:{home}/targets/x86_64-linux/lib')
run(f'{home}/bin/nvcc --version', env=env)
repo = '/content/Hunyuan3D-2/hy3dgen/texgen'
run(f'cd {repo}/custom_rasterizer && {py} setup.py install', env=env)
run(f'cd {repo}/differentiable_renderer && {py} setup.py install', env=env)
print('PAINT_SETUP_COMPLETE', flush=True)
