-- migrate:up
-- Enforce per-tenant data isolation at the data layer.
--
-- The legacy `team_id` column existed in `documents` and `chunks` but was
-- never populated; rename it to `org_slug`, backfill the implicit
-- single-tenant 'default' value, make it NOT NULL DEFAULT 'default', and
-- add a cross-table FK so chunks.org_slug must match documents.org_slug.
-- Add `org_slug` to `semantic_cache` so the embedding-similarity lookup
-- cannot pull another org's cached response.
--
-- Every statement is idempotent: each DDL guards on current state via
-- information_schema / pg_constraint so re-running this migration (manually
-- with psql, or after a backup restore that lost the schema_migrations
-- record) is a no-op.

----------------------------------------------------------------
-- 1) documents: backfill NULL team_id, then rename → org_slug
----------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'private_knowledge'
          AND table_name   = 'documents'
          AND column_name  = 'team_id'
    ) THEN
        UPDATE private_knowledge.documents
        SET    team_id = 'default'
        WHERE  team_id IS NULL;

        ALTER TABLE private_knowledge.documents
        RENAME COLUMN team_id TO org_slug;
    END IF;
END;
$$;

-- ALTER ... SET DEFAULT / SET NOT NULL are idempotent in Postgres
-- (setting to the same value is a no-op). Safe to re-run.
ALTER TABLE private_knowledge.documents
    ALTER COLUMN org_slug SET DEFAULT 'default';
ALTER TABLE private_knowledge.documents
    ALTER COLUMN org_slug SET NOT NULL;

----------------------------------------------------------------
-- 2) chunks: same pattern
----------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'private_knowledge'
          AND table_name   = 'chunks'
          AND column_name  = 'team_id'
    ) THEN
        UPDATE private_knowledge.chunks
        SET    team_id = 'default'
        WHERE  team_id IS NULL;

        ALTER TABLE private_knowledge.chunks
        RENAME COLUMN team_id TO org_slug;
    END IF;
END;
$$;

ALTER TABLE private_knowledge.chunks
    ALTER COLUMN org_slug SET DEFAULT 'default';
ALTER TABLE private_knowledge.chunks
    ALTER COLUMN org_slug SET NOT NULL;

----------------------------------------------------------------
-- 3) Drop stale indexes that referenced team_id (idempotent via IF EXISTS)
----------------------------------------------------------------
DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_unique_scope;  -- old (file_id, COALESCE(team_id, ''))
DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_team;          -- old WHERE team_id IS NOT NULL
DROP INDEX IF EXISTS private_knowledge.idx_pk_chunks_team;        -- old WHERE team_id IS NOT NULL

----------------------------------------------------------------
-- 4) Create org-scoped indexes (idempotent via IF NOT EXISTS)
----------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_docs_unique_org_file
    ON private_knowledge.documents(org_slug, file_id);

CREATE INDEX IF NOT EXISTS idx_pk_chunks_org_doc
    ON private_knowledge.chunks(org_slug, document_id);

----------------------------------------------------------------
-- 5) UNIQUE (id, org_slug) on documents — FK target for chunks
----------------------------------------------------------------
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

----------------------------------------------------------------
-- 6) Replace single-column chunks FK with composite (idempotent)
----------------------------------------------------------------
-- DROP IF EXISTS is safe on re-run; after first success the old name
-- no longer exists and this is a no-op.
ALTER TABLE private_knowledge.chunks
    DROP CONSTRAINT IF EXISTS chunks_document_id_fkey;

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

----------------------------------------------------------------
-- 7) semantic_cache: add org_slug column + index (both idempotent)
----------------------------------------------------------------
ALTER TABLE private_knowledge.semantic_cache
    ADD COLUMN IF NOT EXISTS org_slug TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_pk_semcache_org_expires
    ON private_knowledge.semantic_cache(org_slug, expires_at);

-- migrate:down
-- Intentionally empty: re-allowing NULL org_slug would resurrect the
-- cross-tenant leak this migration exists to close. Operators needing
-- to roll back the entire branch should restore from backup.
