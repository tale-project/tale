"""Admin endpoints for Tale RAG service.

Deployment-level operations invoked by the platform (instance-admin actions),
not per-tenant. These are body-driven (no `X-Tale-Org`) and rely on the
platform having already authenticated/authorized the operator and SSRF-gated
the target host — RAG is receive-only on the internal network behind
`verify_auth_token`.
"""

import time
from typing import Literal

import asyncpg
from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

# Mirrors pgConnectionSchema.sslmode (services/platform/lib/shared/schemas/deployment.ts).
SslMode = Literal["disable", "prefer", "require", "verify-ca", "verify-full"]


class DatastoreTestRequest(BaseModel):
    """Candidate external knowledge/app Postgres connection to probe."""

    host: str
    port: int = 5432
    database: str
    user: str
    password: str | None = None
    # Constrained to the supported set so a direct internal caller can't smuggle
    # arbitrary libpq params via this field (defense in depth — the platform
    # already enums it). asyncpg accepts these sslmode strings on `ssl=`.
    sslmode: SslMode = "require"


class DatastoreTestResponse(BaseModel):
    ok: bool
    latency_ms: float | None = None
    version: str | None = None
    # pgvector / pg_search INSTALLABILITY (package present, `CREATE EXTENSION`
    # would succeed) — the correct pre-flight gate for a fresh external DB the
    # init script has not yet provisioned.
    vector_available: bool | None = None
    paradedb_available: bool | None = None
    # Whether the extension is already CREATEd on the target DB. Lets the UI tell
    # "ready now" from "installable but not yet provisioned".
    vector_installed: bool | None = None
    paradedb_installed: bool | None = None
    error: str | None = None


@router.post("/datastore/test-connection", response_model=DatastoreTestResponse)
async def test_datastore_connection(req: DatastoreTestRequest) -> DatastoreTestResponse:
    """Probe an external Postgres for reachability + the extensions the
    knowledge store needs. Never raises on a connection failure — returns
    `{ok: false, error}` so the UI can render an actionable message.

    Connection fields are passed as keyword args (NOT a DSN string) so a host
    carrying URL metacharacters can't smuggle libpq params / downgrade TLS."""
    t0 = time.monotonic()
    try:
        # `ssl=<sslmode>` lets asyncpg apply the requested TLS policy without us
        # building (and mis-parsing) a DSN string from untrusted fields.
        conn = await asyncpg.connect(
            host=req.host,
            port=req.port,
            user=req.user,
            password=req.password or "",
            database=req.database,
            ssl=req.sslmode,
            timeout=8,
        )
    except Exception as exc:  # surface any connect failure to the UI as ok=false
        logger.info("datastore test-connection failed for {}:{}: {}", req.host, req.port, exc)
        return DatastoreTestResponse(ok=False, error=str(exc))
    try:
        version = await conn.fetchval("SELECT version()")
        vector = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vector')")
        paradedb = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_search')")
        vector_inst = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')")
        paradedb_inst = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_search')")
    except Exception as exc:  # report query failure to the UI as ok=false
        logger.info("datastore test-connection query failed for {}: {}", req.host, exc)
        return DatastoreTestResponse(ok=False, error=str(exc))
    finally:
        # Teardown must never override the probe result with a 500 (the endpoint
        # contract is "never raises"). A half-dead socket can also make close()
        # hang, so bound it and log rather than swallow.
        try:
            await conn.close(timeout=5)
        except Exception as exc:
            logger.warning("datastore test-connection close failed for {}: {}", req.host, exc)

    return DatastoreTestResponse(
        ok=True,
        latency_ms=round((time.monotonic() - t0) * 1000, 1),
        version=version,
        vector_available=bool(vector),
        paradedb_available=bool(paradedb),
        vector_installed=bool(vector_inst),
        paradedb_installed=bool(paradedb_inst),
    )
