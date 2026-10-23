#!/usr/bin/env bash
# 等 3d-setup 完成後再跑 hy-textured（在 VM 上執行）
while ! grep -q 3D_SETUP_COMPLETE /content/3d-setup.log 2>/dev/null; do sleep 20; done
cd /content && /content/phoebe-venv/bin/python -u /content/hy-textured.py "$@" >> /content/hy-textured.log 2>&1
