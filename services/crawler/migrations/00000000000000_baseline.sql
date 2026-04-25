-- migrate:up
-- Baseline for public_web schema (crawler service).
-- Assumes database `tale_knowledge` and schema `public_web` already exist
-- (created by services/db/init-scripts/03-create-knowledge-database.sql).
-- Extensions `vector` and `pg_search` are installed at the database level by the same init script.

CREATE SCHEMA IF NOT EXISTS public_web;

-- Websites
CREATE TABLE IF NOT EXISTS public_web.websites (
    domain          TEXT PRIMARY KEY,
    title           TEXT,
    description     TEXT,
    page_count      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'active', 'scanning', 'deleting', 'error', 'completed')),
    scan_interval   INTEGER NOT NULL DEFAULT 21600,
    last_scanned_at TIMESTAMPTZ,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Converge CHECK constraint on existing tables (CREATE TABLE IF NOT EXISTS skips this)
DO $$ BEGIN
    ALTER TABLE public_web.websites DROP CONSTRAINT IF EXISTS websites_status_check;
    ALTER TABLE public_web.websites ADD CONSTRAINT websites_status_check
        CHECK (status IN ('idle', 'active', 'scanning', 'deleting', 'error', 'completed'));
END; $$;

CREATE INDEX IF NOT EXISTS idx_pw_websites_status ON public_web.websites(status);
CREATE INDEX IF NOT EXISTS idx_pw_websites_due ON public_web.websites(status, last_scanned_at);

-- Website URLs
CREATE TABLE IF NOT EXISTS public_web.website_urls (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    domain          TEXT NOT NULL REFERENCES public_web.websites(domain) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    content_hash    TEXT,
    status          TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'active', 'deleted')),
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

CREATE INDEX IF NOT EXISTS idx_pw_urls_domain ON public_web.website_urls(domain);
CREATE INDEX IF NOT EXISTS idx_pw_urls_domain_status ON public_web.website_urls(domain, status);
CREATE INDEX IF NOT EXISTS idx_pw_urls_crawl_order ON public_web.website_urls(domain, last_crawled_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_pw_urls_url ON public_web.website_urls(url);

-- Paragraph hashes (cross-page boilerplate detection)
CREATE TABLE IF NOT EXISTS public_web.page_paragraph_hashes (
    domain          TEXT NOT NULL,
    url             TEXT NOT NULL,
    paragraph_hash  TEXT NOT NULL,
    PRIMARY KEY (domain, url, paragraph_hash),
    FOREIGN KEY (domain, url) REFERENCES public_web.website_urls(domain, url) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pw_pph_domain_hash
    ON public_web.page_paragraph_hashes(domain, paragraph_hash);

-- Chunks (search index)
CREATE TABLE IF NOT EXISTS public_web.chunks (
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
    FOREIGN KEY (domain, url) REFERENCES public_web.website_urls(domain, url) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pw_chunks_domain ON public_web.chunks(domain);
CREATE INDEX IF NOT EXISTS idx_pw_chunks_url ON public_web.chunks(url);
CREATE INDEX IF NOT EXISTS idx_pw_chunks_url_content_hash ON public_web.chunks(url, content_hash);
CREATE INDEX IF NOT EXISTS idx_pw_chunks_domain_url ON public_web.chunks(domain, url);

-- BM25 full-text index (ParadeDB pg_search)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public_web' AND indexname = 'idx_pw_chunks_bm25') THEN
        CREATE INDEX idx_pw_chunks_bm25 ON public_web.chunks
        USING bm25 (id, chunk_content)
        WITH (key_field='id');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BM25 index deferred (public_web): %', SQLERRM;
END;
$$;

-- Dynamic HNSW index for public_web.chunks
CREATE OR REPLACE FUNCTION public_web.create_chunks_hnsw_index()
RETURNS void AS $$
DECLARE
    col_type text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public_web' AND indexname = 'idx_pw_chunks_embedding_hnsw'
    ) THEN
        SELECT format_type(atttypid, atttypmod) INTO col_type
        FROM pg_attribute
        WHERE attrelid = 'public_web.chunks'::regclass AND attname = 'embedding';

        IF col_type = 'vector' THEN
            RAISE EXCEPTION 'public_web.chunks.embedding has no dimensions – pin with ALTER TABLE first';
        END IF;

        EXECUTE 'CREATE INDEX idx_pw_chunks_embedding_hnsw ON public_web.chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
        RAISE NOTICE 'Created HNSW index on public_web.chunks.embedding';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- migrate:down
-- Intentionally empty: baseline is not reversible once subsequent migrations build on it.
-- To reset, drop the schema manually: DROP SCHEMA public_web CASCADE;
