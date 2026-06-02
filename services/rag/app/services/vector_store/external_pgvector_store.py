"""External-pgvector VectorStore driver.

Mirrors `qdrant_store.py` but targets a user-supplied Postgres (reachable from
the RAG service) instead of Qdrant. Embedding vectors are mirrored into a table
in the external database keyed by `chunks.id`, with `org_slug` + `document_id`
columns for tenant + file filtering. Chunk content, document metadata, and the
authoritative per-tenant isolation stay in the built-in Postgres — this driver
handles only ANN upsert/search/delete, exactly like the Qdrant driver.

The table uses cosine distance (`<=>` with `vector_cosine_ops`), so the score
is already cosine similarity in the `1 - distance` convention the rest of the
pipeline expects — identical to the built-in pgvector path.

The external connection pool is created lazily (asyncpg pool creation is async)
and torn down via `close()` at service shutdown.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any
from uuid import UUID

import asyncpg
from loguru import logger
from tale_shared.db import acquire_with_retry

from .base import VectorHit, VectorRecord
from .config_reader import VectorDbConfig

# Source-of-truth schema in the BUILT-IN Postgres (for org-scoped file_id resolution).
SCHEMA = "private_knowledge"
# pgvector HNSW cannot index vectors wider than this (matches `database.py`).
_HNSW_MAX_DIMS = 2000
_UPSERT_BATCH = 500
# Defense-in-depth: RAG reads the config file directly, so re-validate the table
# identifier here even though the platform schema already enforces it.
_PG_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


class ExternalPgvectorStore:
    backend_name = "pgvector_external"
    requires_index_sync = True

    def __init__(self, pool: asyncpg.Pool, config: VectorDbConfig) -> None:
        if not config.pg_host or not config.pg_database or not config.pg_user:
            raise ValueError("external pgvector backend requires host, database and user")
        if not _PG_IDENT_RE.fullmatch(config.pg_table):
            raise ValueError(f"invalid external pgvector table identifier: {config.pg_table!r}")
        # Built-in pool: used only to resolve file_ids -> document UUIDs ORG-SCOPED
        # (the authoritative tenant gate), like the Qdrant driver.
        self._pool = pool
        self._cfg = config
        # Validated identifier above, so direct interpolation is safe. Always
        # qualify with `public` so name resolution is independent of search_path.
        self._table = f"public.{config.pg_table}"
        self._ext_pool: asyncpg.Pool | None = None
        self._ext_lock = asyncio.Lock()

    async def _get_ext_pool(self) -> asyncpg.Pool:
        if self._ext_pool is not None:
            return self._ext_pool
        async with self._ext_lock:
            if self._ext_pool is not None:
                return self._ext_pool
            self._ext_pool = await asyncpg.create_pool(
                host=self._cfg.pg_host,
                port=self._cfg.pg_port,
                user=self._cfg.pg_user,
                password=self._cfg.pg_password,
                database=self._cfg.pg_database,
                # asyncpg maps the libpq sslmode strings via SSLMode.parse.
                ssl=self._cfg.pg_sslmode,
                min_size=1,
                max_size=4,
                command_timeout=30,
                max_inactive_connection_lifetime=120.0,
                server_settings={"search_path": "public"},
            )
            logger.info(
                "Connected external pgvector pool to {}:{}/{} (sslmode={})",
                self._cfg.pg_host,
                self._cfg.pg_port,
                self._cfg.pg_database,
                self._cfg.pg_sslmode,
            )
            return self._ext_pool

    async def ensure_ready(self, dimensions: int) -> None:
        pool = await self._get_ext_pool()
        created = False
        async with acquire_with_retry(pool) as conn:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            exists = await conn.fetchval("SELECT to_regclass($1)", self._table)
            if exists is None:
                await conn.execute(
                    f"""
                    CREATE TABLE {self._table} (
                        id BIGINT PRIMARY KEY,
                        org_slug TEXT NOT NULL,
                        document_id UUID NOT NULL,
                        embedding vector({dimensions})
                    )
                    """
                )
                created = True
                logger.info("Created external pgvector table {} (vector({}))", self._table, dimensions)
            else:
                # An existing table whose vector size differs from the pinned
                # embedding dimensions cannot serve correct ANN results. Fail
                # loud rather than silently search a wrong-dimension index.
                await self._assert_dimensions(conn, dimensions)

            # Tenant + file filters as indexed lookups; HNSW for ANN. All
            # idempotent via IF NOT EXISTS so this converges on every boot.
            await conn.execute(f"CREATE INDEX IF NOT EXISTS {self._cfg.pg_table}_org_idx ON {self._table} (org_slug)")
            await conn.execute(
                f"CREATE INDEX IF NOT EXISTS {self._cfg.pg_table}_org_doc_idx ON {self._table} (org_slug, document_id)"
            )
            if dimensions <= _HNSW_MAX_DIMS:
                await conn.execute(
                    f"CREATE INDEX IF NOT EXISTS {self._cfg.pg_table}_embedding_hnsw "
                    f"ON {self._table} USING hnsw (embedding vector_cosine_ops)"
                )
            else:
                logger.warning(
                    "External pgvector: {} dimensions exceeds the HNSW limit ({}); search will use a sequential scan",
                    dimensions,
                    _HNSW_MAX_DIMS,
                )

        # Copy existing vectors out of the built-in Postgres (no re-embedding)
        # on first creation or whenever the external table is under-populated
        # (interrupted backfill, or a switch away from then back to this
        # backend). Idempotent (upsert keyed on chunk id).
        if created or await self._needs_backfill():
            from .backfill import backfill_vectors

            copied = await backfill_vectors(self._pool, self)
            if copied:
                logger.info("Backfilled {} existing vectors into external pgvector {}", copied, self._table)

    async def _assert_dimensions(self, conn: asyncpg.Connection, dimensions: int) -> None:
        """Raise if an existing table's embedding column != the pinned dims."""
        typmod = await conn.fetchval(
            """
            SELECT a.atttypmod
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = $1
              AND a.attname = 'embedding' AND a.attnum > 0 AND NOT a.attisdropped
            """,
            self._cfg.pg_table,
        )
        if typmod is None:
            raise RuntimeError(
                f"External pgvector table {self._table} exists but has no 'embedding' vector column. "
                f"Use a fresh table name."
            )
        # For pgvector, atttypmod is the declared dimension count (-1 if unspecified).
        if typmod > 0 and typmod != dimensions:
            raise RuntimeError(
                f"External pgvector table {self._table} has vector size {typmod}, but the pinned "
                f"embedding dimensions are {dimensions}. Recreate the table (or configure a fresh "
                f"table name) to change embedding dimensions."
            )

    async def _needs_backfill(self) -> bool:
        """True when the external table has fewer rows than Postgres has vectors."""
        pool = await self._get_ext_pool()
        async with acquire_with_retry(pool) as conn:
            points = await conn.fetchval(f"SELECT count(*) FROM {self._table}")
        points = points or 0
        async with acquire_with_retry(self._pool) as conn:
            source = await conn.fetchval(f"SELECT count(*) FROM {SCHEMA}.chunks WHERE embedding IS NOT NULL")
        source = source or 0
        if points < source:
            logger.info(
                "External pgvector {} under-populated ({} rows < {} source chunks); reconciling via backfill",
                self._table,
                points,
                source,
            )
            return True
        return False

    async def upsert(self, records: list[VectorRecord]) -> None:
        if not records:
            return
        pool = await self._get_ext_pool()
        sql = f"""
            INSERT INTO {self._table} (id, org_slug, document_id, embedding)
            VALUES ($1, $2, $3, $4::vector)
            ON CONFLICT (id) DO UPDATE
              SET org_slug = EXCLUDED.org_slug,
                  document_id = EXCLUDED.document_id,
                  embedding = EXCLUDED.embedding
        """
        for start in range(0, len(records), _UPSERT_BATCH):
            batch = records[start : start + _UPSERT_BATCH]
            rows = [(int(r.chunk_id), r.org_slug, r.document_id, json.dumps(r.embedding)) for r in batch]
            async with acquire_with_retry(pool) as conn, conn.transaction():
                await conn.executemany(sql, rows)

    async def search(
        self,
        org_slug: str,
        embedding: list[float],
        *,
        file_ids: list[str] | None,
        limit: int,
    ) -> list[VectorHit]:
        vec_str = json.dumps(embedding)
        params: list[Any] = [vec_str, org_slug]
        clause = ""
        if file_ids:
            # Resolve file_ids -> document UUIDs ORG-SCOPED IN SQL (against the
            # built-in DB, the authoritative gate) so the external filter can
            # never widen beyond this tenant's documents.
            document_ids = await self._resolve_document_ids(org_slug, file_ids)
            if not document_ids:
                return []
            params.append(document_ids)
            clause = " AND document_id = ANY($3::uuid[])"
        limit_param = len(params) + 1
        params.append(limit)

        sql = f"""
            SELECT id, 1 - (embedding <=> $1::vector) AS score
            FROM {self._table}
            WHERE org_slug = $2{clause}
            ORDER BY embedding <=> $1::vector
            LIMIT ${limit_param}
        """
        pool = await self._get_ext_pool()
        async with acquire_with_retry(pool) as conn:
            rows = await conn.fetch(sql, *params)
        return [VectorHit(chunk_id=r["id"], score=r["score"]) for r in rows]

    async def delete_documents(self, org_slug: str, document_ids: list[UUID]) -> None:
        if not document_ids:
            return
        pool = await self._get_ext_pool()
        async with acquire_with_retry(pool) as conn:
            await conn.execute(
                f"DELETE FROM {self._table} WHERE org_slug = $1 AND document_id = ANY($2::uuid[])",
                org_slug,
                document_ids,
            )

    async def health(self) -> dict[str, Any]:
        try:
            pool = await self._get_ext_pool()
            async with acquire_with_retry(pool) as conn:
                rows = await conn.fetchval(f"SELECT count(*) FROM {self._table}")
            return {
                "backend": self.backend_name,
                "reachable": True,
                "table": self._cfg.pg_table,
                "rows": rows,
            }
        except Exception:
            # Health probe must never raise — report unreachable instead.
            return {"backend": self.backend_name, "reachable": False, "table": self._cfg.pg_table}

    async def close(self) -> None:
        if self._ext_pool is not None:
            await self._ext_pool.close()
            self._ext_pool = None

    async def _resolve_document_ids(self, org_slug: str, file_ids: list[str]) -> list[UUID]:
        """Map external file_ids to internal document UUIDs, org-scoped."""
        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(
                f"SELECT id FROM {SCHEMA}.documents WHERE org_slug = $1 AND file_id = ANY($2)",
                org_slug,
                file_ids,
            )
        return [r["id"] for r in rows]
