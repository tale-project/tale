"""Admin endpoints for Tale RAG service.

Deployment-level operations invoked by the platform (instance-admin actions),
not per-tenant. These are body-driven (no `X-Tale-Org`) and rely on the
platform having already authenticated/authorized the operator and SSRF-gated
the target host — RAG is receive-only on the internal network behind
`verify_auth_token`.
"""

import time
from urllib.parse import quote

import asyncpg
from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class DatastoreTestRequest(BaseModel):
    """Candidate external knowledge/app Postgres connection to probe."""

    host: str
    port: int = 5432
    database: str
    user: str
    password: str | None = None
    sslmode: str = Field(default="require")


class DatastoreTestResponse(BaseModel):
    ok: bool
    latency_ms: float | None = None
    version: str | None = None
    # pgvector availability — required for the knowledge DB.
    vector_available: bool | None = None
    # ParadeDB pg_search availability — required for full hybrid (BM25) search;
    # absent means retrieval degrades to vector-only.
    paradedb_available: bool | None = None
    error: str | None = None


@router.post("/datastore/test-connection", response_model=DatastoreTestResponse)
async def test_datastore_connection(req: DatastoreTestRequest) -> DatastoreTestResponse:
    """Probe an external Postgres for reachability + the extensions the
    knowledge store needs. Never raises on a connection failure — returns
    `{ok: false, error}` so the UI can render an actionable message."""
    dsn = (
        f"postgresql://{quote(req.user, safe='')}:{quote(req.password or '', safe='')}"
        f"@{req.host}:{req.port}/{quote(req.database, safe='')}?sslmode={req.sslmode}"
    )
    t0 = time.monotonic()
    try:
        conn = await asyncpg.connect(dsn, timeout=8)
    except Exception as exc:  # surface any connect failure to the UI as ok=false
        logger.info("datastore test-connection failed for {}:{}: {}", req.host, req.port, exc)
        return DatastoreTestResponse(ok=False, error=str(exc))
    try:
        version = await conn.fetchval("SELECT version()")
        vector = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vector')")
        paradedb = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_search')")
    except Exception as exc:  # report query failure to the UI as ok=false
        logger.info("datastore test-connection query failed for {}: {}", req.host, exc)
        return DatastoreTestResponse(ok=False, error=str(exc))
    finally:
        await conn.close()

    return DatastoreTestResponse(
        ok=True,
        latency_ms=round((time.monotonic() - t0) * 1000, 1),
        version=version,
        vector_available=bool(vector),
        paradedb_available=bool(paradedb),
    )
