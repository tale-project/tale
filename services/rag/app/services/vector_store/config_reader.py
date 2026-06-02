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

VALID_BACKENDS = ("pgvector", "pgvector_external", "qdrant")
DEFAULT_COLLECTION = "tale_chunks"
DEFAULT_PG_TABLE = "tale_vectors"
DEFAULT_PG_PORT = 5432
DEFAULT_PG_SSLMODE = "require"


@dataclass(frozen=True)
class VectorDbConfig:
    """Resolved deployment vector-store config (secret already decrypted).

    TLS for Qdrant is governed by the ``qdrant_url`` scheme (http/https), so
    there is no separate https flag; for external pgvector it is governed by
    ``pg_sslmode``.
    """

    backend: str = "pgvector"
    # Qdrant
    qdrant_url: str | None = None
    collection: str = DEFAULT_COLLECTION
    prefer_grpc: bool = False
    api_key: str | None = None
    # External pgvector (user-supplied Postgres reachable from RAG)
    pg_host: str | None = None
    pg_port: int = DEFAULT_PG_PORT
    pg_database: str | None = None
    pg_user: str | None = None
    pg_sslmode: str = DEFAULT_PG_SSLMODE
    pg_table: str = DEFAULT_PG_TABLE
    pg_password: str | None = None


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

    # Valid JSON that is not an object (null/array/number/string from a
    # truncated or hand-edited file) would otherwise raise AttributeError on
    # the .get() calls below — keep the fail-safe contract and fall back.
    if not isinstance(data, dict):
        logger.error("vectordb config %s is not a JSON object (%s); using pgvector", config_path, type(data).__name__)
        return VectorDbConfig()

    backend = data.get("backend", "pgvector")
    if backend not in VALID_BACKENDS:
        logger.error("Unknown vectordb backend %r; using pgvector", backend)
        return VectorDbConfig()

    if backend == "pgvector":
        return VectorDbConfig(backend="pgvector")

    if backend == "pgvector_external":
        return _resolve_pgvector_external(data)

    # A truthy non-dict `qdrant` (e.g. a string) survives `... or {}` and would
    # raise AttributeError on .get(); coerce any non-dict to an empty dict.
    qdrant = data.get("qdrant")
    if not isinstance(qdrant, dict):
        qdrant = {}
    url = qdrant.get("url")
    if not url:
        logger.error("vectordb backend is qdrant but no qdrant.url configured; using pgvector")
        return VectorDbConfig()

    try:
        secrets = _load_secrets()
    except _SecretUndecryptable as exc:
        # A secret file exists but can't be decrypted. Connecting to Qdrant
        # unauthenticated would silently drop the configured credential, so
        # fail safe to pgvector with a loud error instead.
        logger.error(
            "vectordb backend is qdrant but its secret could not be decrypted (%s); "
            "using pgvector to avoid an unauthenticated connection",
            exc,
        )
        return VectorDbConfig()

    return VectorDbConfig(
        backend="qdrant",
        qdrant_url=url,
        collection=qdrant.get("collection") or DEFAULT_COLLECTION,
        prefer_grpc=bool(qdrant.get("preferGrpc", False)),
        api_key=secrets.get("apiKey") if secrets else None,
    )


def _resolve_pgvector_external(data: dict) -> VectorDbConfig:
    """Resolve an external-pgvector config, failing safe to built-in pgvector.

    Mirrors the Qdrant fail-safe contract: a missing required field or an
    undecryptable secret falls back to built-in pgvector with a loud error
    rather than booting a broken/unauthenticated external backend.
    """
    pg = data.get("pgvectorExternal")
    if not isinstance(pg, dict):
        pg = {}
    host = pg.get("host")
    database = pg.get("database")
    user = pg.get("user")
    if not host or not database or not user:
        logger.error("vectordb backend is pgvector_external but host/database/user are incomplete; using pgvector")
        return VectorDbConfig()

    try:
        secrets = _load_secrets()
    except _SecretUndecryptable as exc:
        # A secret exists but can't be decrypted — connecting with the wrong
        # (or no) password would silently fail; fail safe with a loud error.
        logger.error(
            "vectordb backend is pgvector_external but its secret could not be decrypted (%s); "
            "using pgvector to avoid a broken connection",
            exc,
        )
        return VectorDbConfig()

    # Password is optional at the protocol level (the DB may use trust/cert
    # auth), but absent here just means no password is sent.
    password = secrets.get("password") if secrets else None

    try:
        port = int(pg.get("port", DEFAULT_PG_PORT))
    except (TypeError, ValueError):
        logger.error("vectordb pgvector_external port is not an integer; using %d", DEFAULT_PG_PORT)
        port = DEFAULT_PG_PORT

    return VectorDbConfig(
        backend="pgvector_external",
        pg_host=host,
        pg_port=port,
        pg_database=database,
        pg_user=user,
        pg_sslmode=pg.get("sslmode") or DEFAULT_PG_SSLMODE,
        pg_table=pg.get("table") or DEFAULT_PG_TABLE,
        pg_password=password,
    )


class _SecretUndecryptable(Exception):
    """A vectordb secret file exists but could not be decrypted.

    Distinguished from an absent file (legitimately no api key) so the caller
    can fail safe rather than silently connect to Qdrant unauthenticated.
    """


def _load_secrets() -> dict | None:
    """Decrypt the deployment vectordb secrets (``apiKey`` and/or ``password``).

    Returns None when no secret file is present (the secret is optional —
    Qdrant may be unauthenticated, external pgvector may use trust/cert auth).
    Returns the decrypted dict otherwise; callers pick the field their backend
    needs. Raises ``_SecretUndecryptable`` when a file IS present but cannot be
    decrypted — never silently degrades a configured credential.
    """
    secrets_path = _deployment_dir() / "vectordb.secrets.json"
    if not secrets_path.exists():
        return None
    try:
        secrets = decrypt_secrets_file(secrets_path)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        logger.error("Failed to decrypt vectordb secrets: %s", exc)
        raise _SecretUndecryptable(str(exc)) from exc
    return secrets if isinstance(secrets, dict) else None
