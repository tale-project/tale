-- migrate:up
--
-- The `public_web` corpus: pages fetched from the web on an organization's
-- behalf, chunked and embedded exactly like uploaded documents so one search
-- can rank both.
--
-- This file is the ONLY declaration of these tables — the same rule as the
-- private_knowledge baseline, for the same reason.
--
-- Tenant boundary: within one knowledge database, a page is fetched and
-- embedded ONCE per domain, and `website_org_memberships` records which
-- organizations asked for that domain. An organization that brings its own
-- database has its own copy of everything and shares nothing at all. Retrieval
-- therefore always joins through the membership table — a query that reads
-- `chunks` without it would return domains the organization never registered.
--
-- The database, its extensions, and this schema namespace are created by
-- services/db/init-scripts/03-create-knowledge-database.sql.

CREATE SCHEMA IF NOT EXISTS public_web;

-- ----------------------------------------------------------------- websites

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

-- `CREATE TABLE IF NOT EXISTS` skips the CHECK on a table an earlier release
-- created, so the constraint is replaced explicitly to converge the allowed
-- status set.
DO $$ BEGIN
    ALTER TABLE public_web.websites DROP CONSTRAINT IF EXISTS websites_status_check;
    ALTER TABLE public_web.websites ADD CONSTRAINT websites_status_check
        CHECK (status IN ('idle', 'active', 'scanning', 'deleting', 'error', 'completed'));
END; $$;

CREATE INDEX IF NOT EXISTS idx_pw_websites_status ON public_web.websites(status);
CREATE INDEX IF NOT EXISTS idx_pw_websites_due ON public_web.websites(status, last_scanned_at);

-- Which organizations asked for which domain. Retrieval joins through this, so
-- a domain another organization registered is invisible to this one.
CREATE TABLE IF NOT EXISTS public_web.website_org_memberships (
    domain   TEXT        NOT NULL REFERENCES public_web.websites(domain) ON DELETE CASCADE,
    org_slug TEXT        NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (domain, org_slug)
);

CREATE INDEX IF NOT EXISTS idx_website_org_memberships_by_org
    ON public_web.website_org_memberships (org_slug);

-- --------------------------------------------------------------------- urls

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

-- Hashes of the paragraphs seen on each page, so navigation and footers that
-- repeat across a site can be recognized as boilerplate and left out of the
-- index instead of dominating it.
CREATE TABLE IF NOT EXISTS public_web.page_paragraph_hashes (
    domain          TEXT NOT NULL,
    url             TEXT NOT NULL,
    paragraph_hash  TEXT NOT NULL,
    PRIMARY KEY (domain, url, paragraph_hash),
    FOREIGN KEY (domain, url) REFERENCES public_web.website_urls(domain, url) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pw_pph_domain_hash
    ON public_web.page_paragraph_hashes(domain, paragraph_hash);

-- ------------------------------------------------------------------- chunks

-- Same four-column text layout as the private corpus, for the same reasons: see
-- the private_knowledge baseline.
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
    context_header  TEXT NOT NULL DEFAULT '',
    core_content    TEXT NOT NULL DEFAULT '',
    prefix_overlap  TEXT NOT NULL DEFAULT '',
    suffix_overlap  TEXT NOT NULL DEFAULT '',
    UNIQUE(url, chunk_index),
    FOREIGN KEY (domain, url) REFERENCES public_web.website_urls(domain, url) ON DELETE CASCADE
);

ALTER TABLE public_web.chunks
    ADD COLUMN IF NOT EXISTS context_header TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS core_content   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prefix_overlap TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suffix_overlap TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pw_chunks_domain ON public_web.chunks(domain);
CREATE INDEX IF NOT EXISTS idx_pw_chunks_url ON public_web.chunks(url);
CREATE INDEX IF NOT EXISTS idx_pw_chunks_url_content_hash ON public_web.chunks(url, content_hash);
CREATE INDEX IF NOT EXISTS idx_pw_chunks_domain_url ON public_web.chunks(domain, url);

-- Deferred with a notice when pg_search is absent; see the private baseline.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public_web' AND indexname = 'idx_pw_chunks_bm25'
    ) THEN
        CREATE INDEX idx_pw_chunks_bm25 ON public_web.chunks
        USING bm25 (id, chunk_content)
        WITH (key_field='id');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BM25 index deferred (public_web): %', SQLERRM;
END;
$$;

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
            RAISE EXCEPTION 'public_web.chunks.embedding has no declared width - pin it with ALTER TABLE first';
        END IF;

        EXECUTE 'CREATE INDEX idx_pw_chunks_embedding_hnsw ON public_web.chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
        RAISE NOTICE 'Created the HNSW index on public_web.chunks.embedding';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- migrate:down
-- Deliberately empty. This is a baseline: later migrations build on it, and
-- dropping the corpus would destroy every crawled page. To start over, drop the
-- schema explicitly: DROP SCHEMA public_web CASCADE;
