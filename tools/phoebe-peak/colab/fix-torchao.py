import subprocess; print(subprocess.run('pip uninstall -y torchao 2>&1 | tail -1',shell=True,capture_output=True,text=True).stdout)
