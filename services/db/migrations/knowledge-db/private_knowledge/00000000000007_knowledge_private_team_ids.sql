-- migrate:up
--
-- Multi-team scope on corpus documents.
--
-- A Tale document can be shared with SEVERAL teams (`teamTags` on the Convex
-- row — listing access is "member of ANY of them"), but 00000000000006 gave
-- the corpus row a single `team_id`, so retrieval only ever matched the FIRST
-- team: a document shared to [sales, support] was searchable by sales members
-- and silently invisible to support members. `team_ids` carries the full list
-- and retrieval filters with array overlap (`team_ids && caller_teams`).
--
-- `team_id` STAYS, as a deprecated mirror of `team_ids[1]`: writers keep
-- stamping both during the transition so a not-yet-upgraded app version (or a
-- row this ALTER predates on some replica) still scopes single-team documents
-- correctly, and the retrieval disjunction keeps `team_id = ANY(...)` as its
-- fallback leg. Dropping the column is a later, explicit migration.
--
-- The backfill below derives `team_ids` from the existing single stamp —
-- exactly right for single-team rows; a multi-team document regains its full
-- list from the Convex-side backfill migration (v0.4.1/02) and from the next
-- ingest or scope sync, all of which write the array. Additive, idempotent,
-- safe on any vintage.
--
-- The GIN index follows the baseline's array-column precedent
-- (`idx_pk_semantic_cache_file_ids` on `semantic_cache.file_ids`); partial,
-- like the scope indexes of 00000000000006, because scoped rows are the
-- minority.

ALTER TABLE private_knowledge.documents
    ADD COLUMN IF NOT EXISTS team_ids TEXT[];

UPDATE private_knowledge.documents
   SET team_ids = ARRAY[team_id]
 WHERE team_id IS NOT NULL AND team_ids IS NULL;

CREATE INDEX IF NOT EXISTS idx_pk_docs_team_ids
    ON private_knowledge.documents USING gin (team_ids)
    WHERE team_ids IS NOT NULL;

-- migrate:down
-- Deliberately empty, like the other private_knowledge migrations: on a
-- database that received this column it immediately holds tenancy scope, and
-- dropping it would silently narrow every multi-team document back to its
-- first team. Remove it with an explicit, reviewed migration instead.
