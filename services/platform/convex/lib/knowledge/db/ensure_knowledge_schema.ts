'use node';

/**
 * Idempotent `private_knowledge` schema bootstrap for a bring-your-own Postgres.
 *
 * The deployment-default `knowledge-db` has its schema applied at startup by the
 * init script + dbmate migrations, so it never runs this. A per-org BYO Postgres
 * (see `knowledge/file_utils.ts`) starts EMPTY — the first RAG query would throw
 * `42P01 undefined_table`. `ensureKnowledgeSchema()` replays the baseline DDL
 * once per newly-seen connection string (guarded in `knowledge_db.ts`), as
 * `CREATE … IF NOT EXISTS`, so a fresh BYO DB is ready to index/search.
 *
 * The DDL is the `private_knowledge` baseline
 * (`services/db/migrations/knowledge-db/private_knowledge/*baseline*.sql`) plus
 * the two `CREATE EXTENSION` statements the init script normally owns — embedded
 * here because a Convex node action cannot reliably read a sibling workspace's
 * `.sql` at runtime. `ensure_knowledge_schema.test.ts` guards the two copies
 * against drift. Only `private_knowledge` (RAG) is bootstrapped per-org; the
 * crawler `public_web` corpus stays on the deployment-default pool.
 *
 * `vector` (pgvector) is REQUIRED — a DB without it cannot do vector search, so
 * we let `CREATE EXTENSION` throw (fail closed; the connection test warns first).
 * `pg_search` (ParadeDB) is OPTIONAL — a plain-pgvector DB degrades to
 * vector-only (the BM25 index creation is already exception-guarded), so its
 * extension creation is wrapped so bootstrap still succeeds without it.
 */

import type { Sql } from 'postgres';

import { logger } from '../logger';
import { withRetry } from './retry';

/**
 * Extensions the baseline assumes are installed database-wide. `vector` is
 * mandatory; `pg_search` is best-effort (ParadeDB-only) so a plain-pgvector BYO
 * DB still bootstraps and serves vector-only search.
 */
const EXTENSIONS_DDL = `
CREATE EXTENSION IF NOT EXISTS vector;
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_search;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_search (ParadeDB) unavailable; BM25 hybrid search disabled for this database: %', SQLERRM;
END
$$;
`;

/**
 * The `private_knowledge` baseline — kept byte-aligned with
 * `services/db/migrations/knowledge-db/private_knowledge/00000000000001_knowledge_private_baseline.sql`
 * (the `migrate:up` body). Every statement is `IF NOT EXISTS` / guarded, so
 * replaying it on a populated DB is a no-op.
 */
const PRIVATE_KNOWLEDGE_BASELINE_DDL = `
CREATE SCHEMA IF NOT EXISTS private_knowledge;

CREATE TABLE IF NOT EXISTS private_knowledge.documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id       TEXT NOT NULL,
    filename      TEXT,
    content_hash  TEXT,
    org_slug      TEXT NOT NULL DEFAULT 'default',
    status        TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
    error         TEXT,
    chunks_count  INTEGER NOT NULL DEFAULT 0,
    progress_phase TEXT,
    progress_detail TEXT,
    source_created_at  TIMESTAMPTZ,
    source_modified_at TIMESTAMPTZ,
    ocr_applied   BOOLEAN NOT NULL DEFAULT FALSE,
    folder_path   TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE private_knowledge.documents
    ADD COLUMN IF NOT EXISTS error              TEXT,
    ADD COLUMN IF NOT EXISTS org_slug           TEXT        NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS progress_phase     TEXT,
    ADD COLUMN IF NOT EXISTS progress_detail    TEXT,
    ADD COLUMN IF NOT EXISTS source_created_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_modified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ocr_applied        BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS folder_path        TEXT,
    ADD COLUMN IF NOT EXISTS metadata           JSONB       NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname  = 'documents_id_org_unique'
          AND  conrelid = 'private_knowledge.documents'::regclass
    ) THEN
        ALTER TABLE private_knowledge.documents
        ADD CONSTRAINT documents_id_org_unique UNIQUE (id, org_slug);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_docs_unique_org_file
    ON private_knowledge.documents(org_slug, file_id);
CREATE INDEX IF NOT EXISTS idx_pk_docs_fileid ON private_knowledge.documents(file_id);
CREATE INDEX IF NOT EXISTS idx_pk_docs_content_hash ON private_knowledge.documents(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_docs_org_folder
    ON private_knowledge.documents (org_slug, folder_path)
    WHERE folder_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_docs_metadata
    ON private_knowledge.documents USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS private_knowledge.chunks (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id    UUID NOT NULL,
    org_slug       TEXT NOT NULL DEFAULT 'default',
    chunk_index    INTEGER NOT NULL,
    chunk_content  TEXT NOT NULL,
    content_hash   TEXT NOT NULL,
    embedding      vector,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    core_content   TEXT NOT NULL DEFAULT '',
    prefix_overlap TEXT NOT NULL DEFAULT '',
    suffix_overlap TEXT NOT NULL DEFAULT '',
    UNIQUE(document_id, chunk_index)
);

ALTER TABLE private_knowledge.chunks
    ADD COLUMN IF NOT EXISTS org_slug       TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS core_content   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prefix_overlap TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suffix_overlap TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname  = 'chunks_document_id_org_fkey'
          AND  conrelid = 'private_knowledge.chunks'::regclass
    ) THEN
        ALTER TABLE private_knowledge.chunks
        ADD CONSTRAINT chunks_document_id_org_fkey
        FOREIGN KEY (document_id, org_slug)
        REFERENCES  private_knowledge.documents(id, org_slug)
        ON DELETE CASCADE;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_pk_chunks_org_doc
    ON private_knowledge.chunks(org_slug, document_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'private_knowledge' AND indexname = 'idx_pk_chunks_bm25') THEN
        CREATE INDEX idx_pk_chunks_bm25 ON private_knowledge.chunks
        USING bm25 (id, chunk_content)
        WITH (key_field='id');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BM25 index deferred (private_knowledge): %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION private_knowledge.create_chunks_hnsw_index()
RETURNS void AS $$
DECLARE
    col_type text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'private_knowledge' AND indexname = 'idx_pk_chunks_embedding_hnsw'
    ) THEN
        SELECT format_type(atttypid, atttypmod) INTO col_type
        FROM pg_attribute
        WHERE attrelid = 'private_knowledge.chunks'::regclass AND attname = 'embedding';

        IF col_type = 'vector' THEN
            RAISE EXCEPTION 'private_knowledge.chunks.embedding has no dimensions – pin with ALTER TABLE first';
        END IF;

        EXECUTE 'CREATE INDEX idx_pk_chunks_embedding_hnsw ON private_knowledge.chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
        RAISE NOTICE 'Created HNSW index on private_knowledge.chunks.embedding';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS private_knowledge.semantic_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_text TEXT NOT NULL,
    query_embedding vector,
    response_text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    file_ids TEXT[] DEFAULT '{}',
    org_slug TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires_at
    ON private_knowledge.semantic_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_file_ids
    ON private_knowledge.semantic_cache USING gin (file_ids);
CREATE INDEX IF NOT EXISTS idx_pk_semcache_org_expires
    ON private_knowledge.semantic_cache(org_slug, expires_at);
`;

/** The full bootstrap DDL: required + optional extensions, then the baseline. */
export const KNOWLEDGE_BOOTSTRAP_DDL = `${EXTENSIONS_DDL}\n${PRIVATE_KNOWLEDGE_BASELINE_DDL}`;

/**
 * Create the `private_knowledge` schema (idempotently) on `sql`. Runs the whole
 * DDL through the simple query protocol so the `DO $$ … $$` blocks and the
 * `create_chunks_hnsw_index()` function body execute as-is (the extended
 * protocol can't run multi-statement / dollar-quoted bodies in one call).
 */
export async function ensureKnowledgeSchema(sql: Sql): Promise<void> {
  await withRetry(() => sql.unsafe(KNOWLEDGE_BOOTSTRAP_DDL).simple());
  logger.info('Ensured private_knowledge schema on knowledge-db connection');
}
