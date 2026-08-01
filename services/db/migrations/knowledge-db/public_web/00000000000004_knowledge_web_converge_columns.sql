-- migrate:up
--
-- Re-states the public_web column convergence under its own version — the same
-- reason as 00000000000003 in private_knowledge: a migration file is applied
-- ONCE, so a column added to the already-applied baseline (as `context_header`
-- was) never reaches a database that migrated before the edit, and every chunk
-- INSERT there fails with "column context_header does not exist". Pure
-- ADD COLUMN IF NOT EXISTS: metadata-only, idempotent, a no-op where the
-- baseline already ran in full.

ALTER TABLE public_web.chunks
    ADD COLUMN IF NOT EXISTS context_header TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS core_content   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prefix_overlap TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suffix_overlap TEXT NOT NULL DEFAULT '';

-- migrate:down
-- Deliberately empty, like the baseline: on a database that only now receives
-- these columns they may immediately hold data, and dropping them would
-- destroy reassembly information. Remove a column with an explicit, reviewed
-- migration instead.
