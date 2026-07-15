'use node';

/**
 * Idempotent knowledge-schema bootstrap for a bring-your-own Postgres — BOTH the
 * `private_knowledge` (RAG) and `public_web` (crawler) corpora.
 *
 * The deployment-default `knowledge-db` has its schema applied at startup by the
 * init script + dbmate migrations, so it never runs this. A per-org BYO Postgres
 * (see `knowledge/file_utils.ts`) starts EMPTY — the first RAG/crawler query
 * would throw `42P01 undefined_table`. `ensureKnowledgeSchema()` replays both
 * baselines' DDL once per newly-seen connection string (guarded in
 * `knowledge_db.ts`), as `CREATE … IF NOT EXISTS`, so a fresh BYO DB is ready to
 * index and search. Nothing in the knowledge databases is shared across
 * organizations, so an org's BYO database carries its OWN crawler corpus too.
 *
 * The DDL is the `private_knowledge` + `public_web` baselines
 * (`services/db/migrations/knowledge-db/{private_knowledge,public_web}/*baseline*.sql`)
 * plus the two `CREATE EXTENSION` statements the init script normally owns —
 * embedded here because a Convex node action cannot reliably read a sibling
 * workspace's `.sql` at runtime. `ensure_knowledge_schema.test.ts` guards all
 * copies against drift.
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

/**
 * The `public_web` (crawler) baseline — kept byte-aligned with
 * `services/db/migrations/knowledge-db/public_web/00000000000002_knowledge_web_baseline.sql`
 * (the `migrate:up` body). Per-org isolation means an org's BYO database carries
 * its OWN crawler corpus, so this is bootstrapped alongside `private_knowledge`.
 * Every statement is `IF NOT EXISTS` / guarded, so replaying it on a populated
 * DB is a no-op.
 */
const PUBLIC_WEB_BASELINE_DDL = `
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

-- Per-org website membership layer. Within one knowledge database the crawler
-- content (websites / website_urls / chunks / page_paragraph_hashes) is shared
-- by the orgs that resolve to it, and this junction table tracks WHICH orgs have
-- asked the crawler to track a given domain. A bring-your-own database isolates
-- an org's crawler corpus entirely.
CREATE TABLE IF NOT EXISTS public_web.website_org_memberships (
    domain   TEXT        NOT NULL REFERENCES public_web.websites(domain) ON DELETE CASCADE,
    org_slug TEXT        NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (domain, org_slug)
);

CREATE INDEX IF NOT EXISTS idx_website_org_memberships_by_org
    ON public_web.website_org_memberships (org_slug);

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
-- Readers fall back to chunk_content when core_content = '' until every row
-- has been reindexed — keep the DEFAULT '' on the overlap columns.
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
    core_content    TEXT NOT NULL DEFAULT '',
    prefix_overlap  TEXT NOT NULL DEFAULT '',
    suffix_overlap  TEXT NOT NULL DEFAULT '',
    UNIQUE(url, chunk_index),
    FOREIGN KEY (domain, url) REFERENCES public_web.website_urls(domain, url) ON DELETE CASCADE
);

-- Converge the overlap columns onto a pre-existing public_web.chunks table.
-- Added by 20260424000001_add_chunk_core_overlap_columns (consolidated into this
-- baseline in #1883); CREATE TABLE IF NOT EXISTS above skips them on a crawler
-- DB that predates that migration. All are defaulted, so the add is safe.
ALTER TABLE public_web.chunks
    ADD COLUMN IF NOT EXISTS core_content   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prefix_overlap TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suffix_overlap TEXT NOT NULL DEFAULT '';

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
`;

/**
 * The full bootstrap DDL: required + optional extensions, then BOTH the
 * `private_knowledge` (RAG) and `public_web` (crawler) baselines — an org's BYO
 * database carries both corpora, isolated from every other org.
 */
export const KNOWLEDGE_BOOTSTRAP_DDL = `${EXTENSIONS_DDL}\n${PRIVATE_KNOWLEDGE_BASELINE_DDL}\n${PUBLIC_WEB_BASELINE_DDL}`;

/**
 * Create the `private_knowledge` + `public_web` schemas (idempotently) on `sql`.
 * Runs the whole DDL through the simple query protocol so the `DO $$ … $$` blocks
 * and the `create_chunks_hnsw_index()` function bodies execute as-is (the
 * extended protocol can't run multi-statement / dollar-quoted bodies in one call).
 */
export async function ensureKnowledgeSchema(sql: Sql): Promise<void> {
  await withRetry(() => sql.unsafe(KNOWLEDGE_BOOTSTRAP_DDL).simple());
  logger.info(
    'Ensured private_knowledge + public_web schemas on knowledge-db connection',
  );
}
