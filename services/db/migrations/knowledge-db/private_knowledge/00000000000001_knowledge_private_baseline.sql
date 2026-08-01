-- migrate:up
--
-- The `private_knowledge` corpus: documents an organization uploaded, their
-- chunks, their embeddings, and the optional semantic cache.
--
-- This file is the ONLY declaration of these tables. The platform reads it —
-- it is also what bootstraps an organization's own bring-your-own database —
-- and never re-declares a table in TypeScript, because the schema was once
-- spelled out in three places and they drifted.
--
-- The database, its extensions, and this schema namespace are created by
-- services/db/init-scripts/03-create-knowledge-database.sql.
--
-- Every organization's rows carry `org_slug`, and every statement the platform
-- issues filters on it. That is the second line of defence: the first is that
-- an organization's pool is resolved per organization, so a bring-your-own
-- database never even contains another tenant's rows.

CREATE SCHEMA IF NOT EXISTS private_knowledge;

-- ---------------------------------------------------------------- documents

CREATE TABLE IF NOT EXISTS private_knowledge.documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id       TEXT NOT NULL,
    filename      TEXT,
    -- Hash of the source bytes. Re-indexing unchanged content is skipped on
    -- this, and identical content elsewhere in the same organization is cloned
    -- rather than re-embedded.
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
    -- Touched on every committed slice, so a `processing` row with a recent
    -- timestamp is a LIVE indexing run rather than an abandoned one. The
    -- watchdog needs that distinction to avoid killing work in progress.
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Converge columns onto a table that already exists.
--
-- `CREATE TABLE IF NOT EXISTS` above is a no-op on a database created by an
-- earlier release, so any column added after that release must be added here
-- too — and BEFORE the indexes and constraints below reference it, or the
-- migration fails with "column does not exist" on exactly the deployments that
-- most need it. Every column is nullable or carries a constant default, so
-- adding it to a populated table is a metadata-only change.
--
-- AND it must ship as a new numbered migration as well (see
-- 00000000000003_knowledge_private_converge_columns.sql): this file's version
-- is already recorded on every migrated database, and an applied migration
-- never runs again — an edit here alone reaches only databases created after
-- the edit.
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

-- The target of the chunks table's composite foreign key, which is what makes
-- a chunk unable to point at another organization's document.
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
CREATE INDEX IF NOT EXISTS idx_pk_docs_content_hash
    ON private_knowledge.documents(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_docs_org_folder
    ON private_knowledge.documents (org_slug, folder_path)
    WHERE folder_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_docs_metadata
    ON private_knowledge.documents USING gin (metadata jsonb_path_ops);

-- ------------------------------------------------------------------- chunks

-- Four text columns, because two contracts hold at once.
--
--   chunk_content  — what is embedded and full-text indexed: the contextual
--                    header followed by the chunk body, so a passage retrieved
--                    alone still says which document and section it came from.
--   context_header — that header on its own, so it can be shown or stripped.
--   core_content   — the chunk's forward-owning slice of the ORIGINAL text, with
--                    no header and no overlap. Concatenating these across a
--                    document reproduces it exactly; concatenating the bodies
--                    would duplicate every overlap seam.
--   prefix_overlap /
--   suffix_overlap — which part of the body is shared with the neighbouring
--                    chunks.
--
-- The overlap columns keep their DEFAULT '' so a reader can fall back to
-- chunk_content on rows written before a re-index.
CREATE TABLE IF NOT EXISTS private_knowledge.chunks (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id    UUID NOT NULL,
    org_slug       TEXT NOT NULL DEFAULT 'default',
    chunk_index    INTEGER NOT NULL,
    chunk_content  TEXT NOT NULL,
    content_hash   TEXT NOT NULL,
    -- Width is pinned at runtime to the organization's declared embedding
    -- dimensions; the column is created unpinned because the target depends on
    -- configuration a migration cannot know.
    embedding      vector,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    context_header TEXT NOT NULL DEFAULT '',
    core_content   TEXT NOT NULL DEFAULT '',
    prefix_overlap TEXT NOT NULL DEFAULT '',
    suffix_overlap TEXT NOT NULL DEFAULT '',
    UNIQUE(document_id, chunk_index)
);

ALTER TABLE private_knowledge.chunks
    ADD COLUMN IF NOT EXISTS org_slug       TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS context_header TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS core_content   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prefix_overlap TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suffix_overlap TEXT NOT NULL DEFAULT '';

-- A chunk's organization must equal its document's. Enforced by the database
-- rather than by convention, so no query can ever attach a chunk to another
-- tenant's document even if application code got it wrong.
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

-- BM25 keyword index. Deferred with a notice rather than failing when pg_search
-- is absent: retrieval degrades to vector-only on such a database, and refusing
-- the whole migration would make a managed Postgres unusable as a corpus.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'private_knowledge' AND indexname = 'idx_pk_chunks_bm25'
    ) THEN
        CREATE INDEX idx_pk_chunks_bm25 ON private_knowledge.chunks
        USING bm25 (id, chunk_content)
        WITH (key_field='id');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BM25 index deferred (private_knowledge): %', SQLERRM;
END;
$$;

-- The HNSW vector index can only be built once the embedding column has a
-- declared width, which happens at runtime from the organization's configured
-- model. This function is what the platform calls after pinning it.
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
            RAISE EXCEPTION 'private_knowledge.chunks.embedding has no declared width - pin it with ALTER TABLE first';
        END IF;

        EXECUTE 'CREATE INDEX idx_pk_chunks_embedding_hnsw ON private_knowledge.chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
        RAISE NOTICE 'Created the HNSW index on private_knowledge.chunks.embedding';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------- semantic cache

-- Optional: nothing writes here unless a deployment installs a cache. Rows are
-- org-scoped and looked up by cosine similarity on the query embedding, so the
-- query_embedding width is pinned at runtime like the chunk embeddings.
CREATE TABLE IF NOT EXISTS private_knowledge.semantic_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_slug TEXT NOT NULL DEFAULT 'default',
    query_text TEXT NOT NULL,
    query_embedding vector,
    response_text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    file_ids TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires_at
    ON private_knowledge.semantic_cache (expires_at);

-- Invalidate a cached answer when one of the documents behind it changes.
CREATE INDEX IF NOT EXISTS idx_semantic_cache_file_ids
    ON private_knowledge.semantic_cache USING gin (file_ids);

-- Every cache lookup filters by organization first; this index is what makes
-- that filter cheap enough that nobody is tempted to drop it.
CREATE INDEX IF NOT EXISTS idx_pk_semcache_org_expires
    ON private_knowledge.semantic_cache(org_slug, expires_at);

-- migrate:down
-- Deliberately empty. This is a baseline: later migrations build on it, and
-- dropping the corpus would destroy every indexed document. To start over,
-- drop the schema explicitly: DROP SCHEMA private_knowledge CASCADE;
