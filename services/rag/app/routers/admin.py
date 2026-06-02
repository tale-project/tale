"""Deployment-level admin endpoints for the Tale RAG service.

Mounted under `Depends(verify_auth_token)` (bearer auth) but WITHOUT
`require_org_slug` — these operations are deployment-wide, not per-tenant,
mirroring the protected `/config` endpoint. The platform's owner/admin gate
already authorizes the operator before the call is made.
"""

import time

import asyncpg
from fastapi import APIRouter
from loguru import logger

from ..models import VectorDbTestConnectionRequest, VectorDbTestConnectionResponse

router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])


@router.post("/vectordb/test-connection", response_model=VectorDbTestConnectionResponse)
async def test_vectordb_connection(
    request: VectorDbTestConnectionRequest,
) -> VectorDbTestConnectionResponse:
    """Open a transient connection to a candidate external Postgres and report
    reachability + whether the `vector` extension is available.

    Uses a one-off `asyncpg.connect` (NOT the RAG pool) so the probe targets
    the operator-supplied database. Never raises — connection failures are
    mapped into `ok=false` with the error message.
    """
    started = time.monotonic()
    conn: asyncpg.Connection | None = None
    try:
        conn = await asyncpg.connect(
            host=request.host,
            port=request.port,
            user=request.user,
            password=request.password,
            database=request.database,
            # asyncpg maps the libpq sslmode strings via SSLMode.parse.
            ssl=request.sslmode,
            timeout=8.0,
        )
        version = await conn.fetchval("SELECT version()")
        pgvector_available = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')"
        )
        latency_ms = int((time.monotonic() - started) * 1000)
        return VectorDbTestConnectionResponse(
            ok=True,
            latency_ms=latency_ms,
            version=version,
            pgvector_available=bool(pgvector_available),
        )
    except Exception as exc:
        latency_ms = int((time.monotonic() - started) * 1000)
        # Log without the request body so the password never lands in logs.
        logger.warning("External pgvector test-connection failed: {}", exc)
        return VectorDbTestConnectionResponse(ok=False, latency_ms=latency_ms, error=str(exc))
    finally:
        if conn is not None:
            await conn.close()
