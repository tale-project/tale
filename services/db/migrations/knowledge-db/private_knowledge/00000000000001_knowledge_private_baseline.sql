-- migrate:up
-- Baseline for private_knowledge schema (RAG service).
-- Assumes database `tale_knowledge` and schema `private_knowledge` already exist
-- (created by services/db/init-scripts/03-create-knowledge-database.sql).
-- Extensions `vector` and `pg_search` are installed at the database level by the same init script.

CREATE SCHEMA IF NOT EXISTS private_knowledge;

-- Documents
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

-- Converge columns onto a pre-existing `documents` table.
-- On deployments created by the old per-service RAG migrations
-- (services/rag/migrations/*, consolidated into this baseline in #1883) the
-- table already exists, so the CREATE TABLE IF NOT EXISTS above is a no-op and
-- never adds columns introduced by later RAG migrations. They must be added
-- here BEFORE any index/constraint below depends on them — e.g. the GIN index
-- idx_pk_docs_metadata (added by 20260611000002_add_document_metadata) fails
-- with `column "metadata" does not exist` (42703) on a DB that had only reached
-- 20260611000001_add_documents_folder_path. Every column is nullable or carries
-- a constant DEFAULT, so adding it to a populated table is a safe, metadata-only
-- change. Mirrors the CHECK-constraint convergence in the public_web baseline.
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

-- UNIQUE (id, org_slug) — FK target for chunks composite FK
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

-- Chunks
-- Readers must fall back to chunk_content when core_content = '' until every
-- row has been reindexed (see services/rag/app/services/rag_service.py and
-- search_service.py) — keep the DEFAULT '' on the overlap columns.
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

-- Converge columns onto a pre-existing `chunks` table (see the documents note
-- above). org_slug was added by 20260528000001_enforce_org_slug; the overlap
-- columns by 20260424000001_add_chunk_core_overlap_columns. org_slug must exist
-- before the composite FK and idx_pk_chunks_org_doc below reference it. All are
-- defaulted, so adding them to a populated table is safe.
ALTER TABLE private_knowledge.chunks
    ADD COLUMN IF NOT EXISTS org_slug       TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS core_content   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prefix_overlap TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suffix_overlap TEXT NOT NULL DEFAULT '';

-- Composite FK so chunks.org_slug must match documents.org_slug
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

-- BM25 full-text index on private_knowledge.chunks
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

-- Dynamic HNSW index for private_knowledge.chunks
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

-- Semantic cache for RAG query result caching.
-- Uses pgvector for cosine similarity lookups on query embeddings.
-- query_embedding is nullable; the HNSW index on it is created at runtime by
-- the RAG service once the embedding dimensions are known (same pattern as chunks).
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

-- B-tree index for TTL cleanup
CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires_at
    ON private_knowledge.semantic_cache (expires_at);

-- GIN index for file-based invalidation
CREATE INDEX IF NOT EXISTS idx_semantic_cache_file_ids
    ON private_knowledge.semantic_cache USING gin (file_ids);

-- Org-scoped TTL index (cross-tenant isolation on similarity lookups)
CREATE INDEX IF NOT EXISTS idx_pk_semcache_org_expires
    ON private_knowledge.semantic_cache(org_slug, expires_at);

-- migrate:down
-- Intentionally empty: baseline is not reversible once subsequent migrations build on it.
-- To reset, drop the schema manually: DROP SCHEMA private_knowledge CASCADE;
