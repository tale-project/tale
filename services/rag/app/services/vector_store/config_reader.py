"""Deployment-level vector-store configuration reader.

Reads ONE deployment-wide config file (not per-org) that selects the
vector-store backend the RAG service uses, plus its decrypted secret.
Mirrors the read + SOPS pattern in ``tale_shared.config.providers`` but
for a single file at ``<base>/.system/vectordb.json``.

The platform admin UI writes this file; RAG reads it once at startup
(switching backends is an infra-level change that takes effect on
restart, matching the process-scoped pool + dimension pin).

Backward compatible: when the file is absent the backend defaults to
pgvector, so existing deployments keep working untouched.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from tale_shared.config.org_slug import ORG_SLUG_RE
from tale_shared.utils.sops import decrypt_secrets_file

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_DIR = "/app/data"

# Deployment-scoped config lives OUTSIDE any org dir. A leading dot can
# never be a valid org slug (ORG_SLUG_RE requires `[a-z0-9]` first), so
# `.system/` cannot collide with `<base>/<org_slug>/`. Assert it so a
# future regex change that would allow the collision fails loudly here.
DEPLOYMENT_DIR = ".system"
assert not ORG_SLUG_RE.fullmatch(DEPLOYMENT_DIR), "DEPLOYMENT_DIR must not be a valid org slug"

VALID_BACKENDS = ("pgvector", "qdrant")
DEFAULT_COLLECTION = "tale_chunks"


@dataclass(frozen=True)
class VectorDbConfig:
    """Resolved deployment vector-store config (secret already decrypted).

    TLS is governed by the ``qdrant_url`` scheme (http/https), so there is
    no separate https flag.
    """

    backend: str = "pgvector"
    qdrant_url: str | None = None
    collection: str = DEFAULT_COLLECTION
    prefer_grpc: bool = False
    api_key: str | None = None


def _config_base() -> Path:
    """Resolve the config root, mirroring providers.py base resolution."""
    shared = os.environ.get("TALE_PLATFORM_SHARED_CONFIG_DIR")
    if shared:
        return Path(shared)
    return Path(os.environ.get("TALE_CONFIG_DIR") or os.environ.get("CONFIG_DIR", DEFAULT_CONFIG_DIR))


def _deployment_dir() -> Path:
    return _config_base() / DEPLOYMENT_DIR


def load_vectordb_config() -> VectorDbConfig:
    """Read the deployment vector-store config. Defaults to pgvector when
    the file is absent or unreadable (fail safe — never crash startup over
    a missing/garbled config; the built-in backend keeps RAG serving)."""
    config_path = _deployment_dir() / "vectordb.json"
    if not config_path.is_file():
        logger.info("No deployment vectordb config at %s; using pgvector", config_path)
        return VectorDbConfig()

    try:
        with open(config_path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("Failed to read vectordb config %s: %s; using pgvector", config_path, exc)
        return VectorDbConfig()

    backend = data.get("backend", "pgvector")
    if backend not in VALID_BACKENDS:
        logger.error("Unknown vectordb backend %r; using pgvector", backend)
        return VectorDbConfig()

    if backend == "pgvector":
        return VectorDbConfig(backend="pgvector")

    qdrant = data.get("qdrant") or {}
    url = qdrant.get("url")
    if not url:
        logger.error("vectordb backend is qdrant but no qdrant.url configured; using pgvector")
        return VectorDbConfig()

    return VectorDbConfig(
        backend="qdrant",
        qdrant_url=url,
        collection=qdrant.get("collection") or DEFAULT_COLLECTION,
        prefer_grpc=bool(qdrant.get("preferGrpc", False)),
        api_key=_load_secret(),
    )


def _load_secret() -> str | None:
    """Decrypt the deployment vectordb secret (apiKey) if present."""
    secrets_path = _deployment_dir() / "vectordb.secrets.json"
    if not secrets_path.exists():
        return None
    try:
        secrets = decrypt_secrets_file(secrets_path)
        return secrets.get("apiKey")
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        logger.error("Failed to decrypt vectordb secrets: %s", exc)
        return None
