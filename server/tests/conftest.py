from __future__ import annotations

from pathlib import Path

import pytest

from server.app import Settings


@pytest.fixture
def service_settings(tmp_path: Path) -> Settings:
    site_dir = tmp_path / "site"
    content_dir = tmp_path / "content"
    (site_dir / "shell").mkdir(parents=True)
    (content_dir / "sdk").mkdir(parents=True)
    (content_dir / "games" / "community").mkdir(parents=True)
    return Settings(
        shell_port=54470,
        content_port=54471,
        bind="127.0.0.1",
        shell_origin="http://localhost:54470",
        content_origin="http://127.0.0.1:54471",
        api_origin="https://coinpilet.win",
        retire_base="http://127.0.0.1:54432",
        site_dir=site_dir,
        content_dir=content_dir,
    )
