-- migrate:up
--
-- Re-states the private_knowledge column convergence under its own version.
--
-- The baseline converges columns onto tables an earlier release created — but
-- a migration file is applied ONCE. A database that recorded the baseline's
-- version before a column was added to that file never runs the file again, so
-- editing an already-applied migration silently loses the edit on exactly the
-- databases that need it. `context_header` was added to the baseline that way:
-- every corpus provisioned before the edit is missing the column, and every
-- chunk INSERT on it fails with "column context_header does not exist".
--
-- Hence this file: the baseline's complete convergence set again, as a NEW
-- version, so every database — bundled (dbmate at container start) or
-- bring-your-own (the platform bootstrap) — actually applies it. Pure
-- ADD COLUMN IF NOT EXISTS with constant defaults: metadata-only, idempotent,
-- safe on any vintage, a no-op where the baseline already ran in full.
--
-- The rule this file exists to encode: a column added to the baseline must
-- ALSO ship as a new numbered migration.

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

ALTER TABLE private_knowledge.chunks
    ADD COLUMN IF NOT EXISTS org_slug       TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS context_header TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS core_content   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prefix_overlap TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suffix_overlap TEXT NOT NULL DEFAULT '';

-- migrate:down
-- Deliberately empty, like the baseline: on a database that only now receives
-- these columns they may immediately hold data, and dropping them would
-- destroy reassembly and tenancy information. Remove a column with an
-- explicit, reviewed migration instead.
