"""SOPS decrypt utility for encrypted JSON files."""

import json
import subprocess
from pathlib import Path

_cache: dict[str, tuple[dict, float]] = {}


def decrypt_secrets_file(file_path: str | Path) -> dict:
    """Decrypt a SOPS-encrypted JSON file. Caches by mtime."""
    path = Path(file_path).resolve()
    mtime = path.stat().st_mtime
    cached = _cache.get(str(path))
    if cached and cached[1] == mtime:
        return cached[0]

    result = subprocess.run(
        ["sops", "-d", "--output-type", "json", str(path)],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Failed to decrypt {path}: {result.stderr}. "
            "Ensure sops is installed and SOPS_AGE_KEY is set."
        )

    data = json.loads(result.stdout)
    _cache[str(path)] = (data, mtime)
    return data
