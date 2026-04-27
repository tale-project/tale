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
    team_id       TEXT,
    status        TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
    error         TEXT,
    chunks_count  INTEGER NOT NULL DEFAULT 0,
    progress_phase TEXT,
    progress_detail TEXT,
    source_created_at  TIMESTAMPTZ,
    source_modified_at TIMESTAMPTZ,
    ocr_applied   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_docs_unique_scope
    ON private_knowledge.documents(file_id, COALESCE(team_id, ''));
CREATE INDEX IF NOT EXISTS idx_pk_docs_fileid ON private_knowledge.documents(file_id);
CREATE INDEX IF NOT EXISTS idx_pk_docs_team ON private_knowledge.documents(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_docs_content_hash ON private_knowledge.documents(content_hash) WHERE content_hash IS NOT NULL;

-- Chunks
CREATE TABLE IF NOT EXISTS private_knowledge.chunks (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id    UUID NOT NULL REFERENCES private_knowledge.documents(id) ON DELETE CASCADE,
    team_id        TEXT,
    chunk_index    INTEGER NOT NULL,
    chunk_content  TEXT NOT NULL,
    content_hash   TEXT NOT NULL,
    embedding      vector,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_pk_chunks_team ON private_knowledge.chunks(team_id) WHERE team_id IS NOT NULL;

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

-- migrate:down
-- Intentionally empty: baseline is not reversible once subsequent migrations build on it.
-- To reset, drop the schema manually: DROP SCHEMA private_knowledge CASCADE;
