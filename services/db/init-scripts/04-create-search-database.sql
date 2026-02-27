-- Tale DB: Crawler search database (pgvector + pg_search BM25)
-- Idempotent: safe to run on every startup

SELECT 'CREATE DATABASE tale_search'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tale_search')
\gexec

GRANT ALL PRIVILEGES ON DATABASE tale_search TO tale;

\c tale_search

DROP EXTENSION IF EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_search";

-- ============================================================================
-- Websites
-- ============================================================================

CREATE TABLE IF NOT EXISTS websites (
    domain          TEXT PRIMARY KEY,
    title           TEXT,
    description     TEXT,
    page_count      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'idle',
    scan_interval   INTEGER NOT NULL DEFAULT 21600,
    last_scanned_at TIMESTAMPTZ,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_websites_status ON websites(status);
CREATE INDEX IF NOT EXISTS idx_websites_due ON websites(status, last_scanned_at);

-- ============================================================================
-- Website URLs
-- ============================================================================

CREATE TABLE IF NOT EXISTS website_urls (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    domain          TEXT NOT NULL REFERENCES websites(domain) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    content_hash    TEXT,
    status          TEXT NOT NULL DEFAULT 'discovered',
    last_crawled_at TIMESTAMPTZ,
    discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    title           TEXT,
    content         TEXT,
    word_count      INTEGER,
    metadata        JSONB,
    structured_data JSONB,
    fail_count      INTEGER NOT NULL DEFAULT 0,
    etag            TEXT,
    last_modified   TEXT,
    UNIQUE(domain, url)
);

CREATE INDEX IF NOT EXISTS idx_website_urls_domain ON website_urls(domain);
CREATE INDEX IF NOT EXISTS idx_website_urls_domain_status ON website_urls(domain, status);
CREATE INDEX IF NOT EXISTS idx_website_urls_crawl_order ON website_urls(domain, last_crawled_at NULLS FIRST);

-- ============================================================================
-- Chunks (search index)
-- ============================================================================

CREATE TABLE IF NOT EXISTS chunks (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    domain          TEXT NOT NULL,
    url             TEXT NOT NULL,
    title           TEXT,
    content_hash    TEXT NOT NULL,
    chunk_index     INTEGER NOT NULL,
    chunk_content   TEXT NOT NULL,
    embedding       vector,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(url, chunk_index),
    FOREIGN KEY (domain, url) REFERENCES website_urls(domain, url) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_domain ON chunks(domain);
CREATE INDEX IF NOT EXISTS idx_chunks_url ON chunks(url);
CREATE INDEX IF NOT EXISTS idx_chunks_url_content_hash ON chunks(url, content_hash);

-- BM25 full-text index (ParadeDB pg_search)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_chunks_bm25') THEN
        CREATE INDEX idx_chunks_bm25 ON chunks
        USING bm25 (id, chunk_content)
        WITH (key_field='id');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BM25 index deferred: %', SQLERRM;
END;
$$;

-- Dynamic HNSW index (vector dimensions are configurable).
-- The embedding column starts as untyped `vector`; the application pins it to
-- an explicit dimension at startup via ALTER TABLE before calling this function.
CREATE OR REPLACE FUNCTION create_chunks_hnsw_index()
RETURNS void AS $$
DECLARE
    col_type text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'chunks' AND indexname = 'idx_chunks_embedding_hnsw'
    ) THEN
        -- Verify the column has explicit dimensions (e.g. vector(1536), not bare vector)
        SELECT format_type(atttypid, atttypmod) INTO col_type
        FROM pg_attribute
        WHERE attrelid = 'chunks'::regclass AND attname = 'embedding';

        IF col_type = 'vector' THEN
            RAISE EXCEPTION 'embedding column has no dimensions – pin it with ALTER TABLE first';
        END IF;

        EXECUTE 'CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
        RAISE NOTICE 'Created HNSW index on chunks.embedding';
    END IF;
END;
$$ LANGUAGE plpgsql;
