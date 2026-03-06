-- Tale DB: Unified knowledge database (crawler + RAG)
-- Two schemas: public_web (crawler) and private_knowledge (RAG)
-- Idempotent: safe to run on every startup

SELECT 'CREATE DATABASE tale_knowledge'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tale_knowledge')
\gexec

GRANT ALL PRIVILEGES ON DATABASE tale_knowledge TO tale;

\c tale_knowledge

-- LEGACY CLEANUP (safe to remove once all environments are migrated, see 01-init-extensions.sql).
DO $$
BEGIN
    BEGIN ALTER EVENT TRIGGER timescaledb_ddl_command_end DISABLE; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER EVENT TRIGGER timescaledb_ddl_sql_drop DISABLE; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN DROP EXTENSION IF EXISTS timescaledb CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$$;
DROP EVENT TRIGGER IF EXISTS timescaledb_ddl_command_end;
DROP EVENT TRIGGER IF EXISTS timescaledb_ddl_sql_drop;

-- Extensions (database-level, shared by both schemas)
CREATE EXTENSION IF NOT EXISTS "vector";
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_search";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_search extension not available, BM25 search will be disabled: %', SQLERRM;
END; $$;


-- ============================================================================
-- Schema: public_web (crawler service)
-- ============================================================================

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


-- ============================================================================
-- Schema: private_knowledge (RAG service)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private_knowledge;

-- Documents
CREATE TABLE IF NOT EXISTS private_knowledge.documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id   TEXT NOT NULL,
    filename      TEXT,
    content_hash  TEXT,
    team_id       TEXT,
    user_id       TEXT,
    status        TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
    error         TEXT,
    chunks_count  INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_docs_unique_scope
    ON private_knowledge.documents(document_id, COALESCE(team_id, ''), COALESCE(user_id, ''));
CREATE INDEX IF NOT EXISTS idx_pk_docs_docid ON private_knowledge.documents(document_id);
CREATE INDEX IF NOT EXISTS idx_pk_docs_team ON private_knowledge.documents(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_docs_user ON private_knowledge.documents(user_id) WHERE user_id IS NOT NULL;

-- Chunks
CREATE TABLE IF NOT EXISTS private_knowledge.chunks (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id    UUID NOT NULL REFERENCES private_knowledge.documents(id) ON DELETE CASCADE,
    team_id        TEXT,
    user_id        TEXT,
    chunk_index    INTEGER NOT NULL,
    chunk_content  TEXT NOT NULL,
    content_hash   TEXT NOT NULL,
    embedding      vector,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_pk_chunks_team ON private_knowledge.chunks(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_chunks_user ON private_knowledge.chunks(user_id) WHERE user_id IS NOT NULL;

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



-- ============================================================================
-- Roles + search_path
-- ============================================================================

ALTER ROLE tale IN DATABASE tale_knowledge SET search_path TO public_web, private_knowledge, public;

GRANT USAGE ON SCHEMA public_web TO tale;
GRANT USAGE ON SCHEMA private_knowledge TO tale;
GRANT ALL ON ALL TABLES IN SCHEMA public_web TO tale;
GRANT ALL ON ALL TABLES IN SCHEMA private_knowledge TO tale;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public_web TO tale;
GRANT ALL ON ALL SEQUENCES IN SCHEMA private_knowledge TO tale;
ALTER DEFAULT PRIVILEGES IN SCHEMA public_web GRANT ALL ON TABLES TO tale;
ALTER DEFAULT PRIVILEGES IN SCHEMA private_knowledge GRANT ALL ON TABLES TO tale;
ALTER DEFAULT PRIVILEGES IN SCHEMA public_web GRANT ALL ON SEQUENCES TO tale;
ALTER DEFAULT PRIVILEGES IN SCHEMA private_knowledge GRANT ALL ON SEQUENCES TO tale;
