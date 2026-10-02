from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def test_sdk_request_queue_and_ready() -> None:
    harness = Path(__file__).with_name("sdk_request_test.mjs")
    proc = subprocess.run(
        ["node", str(harness)],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "sdk_request_test ok" in proc.stdout
