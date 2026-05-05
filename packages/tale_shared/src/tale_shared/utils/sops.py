"""Provider secrets read utility.

Hybrid format detection mirrors the TypeScript implementation in
``services/platform/convex/lib/sops.ts``: a SOPS-encrypted JSON file
always carries a top-level ``"sops"`` object describing recipients and
metadata. We use that as the read-time signal — if present, decrypt via
the ``sops`` CLI; if absent, return the parsed plaintext JSON as-is.

The ``SOPS_AGE_KEY`` / ``SOPS_AGE_KEY_FILE`` env vars are still required
to decrypt encrypted files; encountering an encrypted file without a key
configured raises :class:`EncryptedFileWithoutKeyError`.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

_cache: dict[str, tuple[dict, float]] = {}

_plaintext_warn_emitted = False


class EncryptedFileWithoutKeyError(RuntimeError):
    """Raised when a SOPS-encrypted secrets file is read without a key set."""


def _has_sops_key() -> bool:
    """True iff a SOPS age key is configured via env (trim-aware)."""
    return bool((os.environ.get("SOPS_AGE_KEY") or "").strip() or (os.environ.get("SOPS_AGE_KEY_FILE") or "").strip())


def _is_sops_encrypted_shape(parsed: object) -> bool:
    return isinstance(parsed, dict) and "sops" in parsed


def _emit_plaintext_warn_once(file_path: Path) -> None:
    global _plaintext_warn_emitted
    if _plaintext_warn_emitted:
        return
    _plaintext_warn_emitted = True
    logger.warning(
        "[secrets] SOPS_AGE_KEY not set — provider secrets at %s read as "
        "plaintext JSON. To enable encryption: run age-keygen, add "
        "SOPS_AGE_KEY=... to .env, then re-save secrets via Settings → AI providers.",
        file_path,
    )


def decrypt_secrets_file(file_path: str | Path) -> dict:
    """Read a provider secrets file. Decrypts SOPS-encrypted files; returns
    plaintext JSON files as-is. Caches by mtime."""
    path = Path(file_path).resolve()
    mtime = path.stat().st_mtime
    cached = _cache.get(str(path))
    if cached and cached[1] == mtime:
        return cached[0]

    raw = path.read_text(encoding="utf-8")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Failed to parse secrets file {path} as JSON: {exc}") from exc

    if _is_sops_encrypted_shape(parsed):
        if not _has_sops_key():
            raise EncryptedFileWithoutKeyError(
                f"Secrets file {path} is SOPS-encrypted but neither SOPS_AGE_KEY "
                "nor SOPS_AGE_KEY_FILE is set. Set one in .env to decrypt, or "
                "remove the file and re-enter the key in Settings → AI providers "
                "to store as plaintext."
            )
        result = subprocess.run(
            ["sops", "-d", "--output-type", "json", str(path)],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"Failed to decrypt {path}: {result.stderr}. "
                "Ensure sops is installed and SOPS_AGE_KEY or SOPS_AGE_KEY_FILE is set correctly."
            )
        data = json.loads(result.stdout)
    else:
        if not isinstance(parsed, dict):
            raise RuntimeError(f"Secrets file {path} must contain a JSON object at the top level.")
        _emit_plaintext_warn_once(path)
        data = parsed

    _cache[str(path)] = (data, mtime)
    return data
