-- Caller-owned external keys: the twins 0093 left behind are detached, and
-- the canonical rule becomes an index the database cannot forget.
--
-- 0093 brought every project `external_item_id` and every task
-- (`external_system`, `external_id`) to the canonical form the domains
-- compare — NFC, trimmed — but SKIPPED a row whose canonical form another
-- row of the same scope already held, byte-exact or as ITS canonical form,
-- so the byte-exact unique indexes were never violated. Its header says the
-- oldest row of such a group keeps the canonical spelling; that is not what
-- its two guards do: a row that already HOLDS the canonical bytes wins
-- however young, and the oldest wins only among rows that all need
-- rewriting. The 2026-09-12 evaluation (S2-3) found the residue live: a
-- project stored in NFD beside a newer NFC twin could not be found by
-- `GET /api/v1/projects?externalItemId=` under either spelling — the lookup
-- canonicalises the key and compares bytes, so the NFD row never matches —
-- and nothing on the API could repair it. The boot runner swallows
-- notices, so nothing was logged either. (0093 stays as shipped: a
-- migration file is never edited once applied.)
--
-- Detection — the groups this file acts on (projects; tasks alike, grouped
-- by project_id and BOTH canonical columns):
--
--   SELECT org_id,
--          regexp_replace(normalize(external_item_id, NFC),
--                         '^[[:space:]]+|[[:space:]]+$', '', 'g') AS canon,
--          count(*)
--   FROM app.projects
--   WHERE external_item_id IS NOT NULL
--   GROUP BY 1, 2
--   HAVING count(*) > 1;
--
-- Repair rule: in each group ONE row keeps the key — the row that already
-- holds the canonical bytes when there is one (it is the row every lookup
-- has been finding), else the oldest (`created_at_ms`, then `id`) — and
-- every other row is DETACHED, never merged, never deleted (the 0059 and
-- 0073 precedent): a project or a task is the user's content and stays
-- reachable by id, in the listing and on the board. A detached project
-- loses `external_item_id` and is stamped `updated_at_ms`; it reads with no
-- `externalItemId` on the API and `PATCH /api/v1/projects/{id}` re-keys it.
-- A detached task loses `external_system` and `external_id` and keeps its
-- `external_url` for human traceability, as 0059 left its duplicates. A
-- keeper that is not yet canonical (a group 0093 never saw a holder in) is
-- then brought to the canonical form its twins made room for, so every key
-- that survives is one the lookup finds.
--
-- The rule then moves into the schema: a unique index on the CANONICAL
-- expression of the key, beside the byte-exact one (`projects_org_external_
-- item` from 0008, `tasks_project_external_unique` from 0059 — the doors
-- name them in their 409 paths and the lookups still hit them). Every
-- current writer canonicalises before it writes, so the new indexes never
-- fire for the code that ships with this file; they exist so that a raw
-- write, a lane that forgets, or a rolled-back image can never again create
-- a twin the lookup cannot reach. `normalize()` and `regexp_replace()` are
-- IMMUTABLE, so both are indexable; `normalize()` needs PostgreSQL 13 and a
-- UTF-8 server encoding, as 0093 did.
--
-- Idempotent: on a repaired table every group has one member, so the detach
-- UPDATEs find no row, and the indexes are IF NOT EXISTS. Rolling-deploy
-- safe: the previous image canonicalises every key it writes and looks up
-- (0093's code shipped with it), so it never trips the new indexes, and a
-- key set NULL here is the "no key" its doors already understand.

-- Projects: one key per (org_id, canonical external_item_id).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id,
                        regexp_replace(normalize(external_item_id, NFC),
                                       '^[[:space:]]+|[[:space:]]+$', '', 'g')
           ORDER BY (external_item_id =
                       regexp_replace(normalize(external_item_id, NFC),
                                      '^[[:space:]]+|[[:space:]]+$', '', 'g')) DESC,
                    created_at_ms ASC,
                    id ASC
         ) AS keep_rank
  FROM app.projects
  WHERE external_item_id IS NOT NULL
)
UPDATE app.projects p
SET external_item_id = NULL,
    updated_at_ms = (extract(epoch FROM now()) * 1000)::bigint
FROM ranked
WHERE p.id = ranked.id AND ranked.keep_rank > 1;

-- The keepers left non-canonical (0093's own rule, now without twins in
-- the way; a key blank once canonical names nothing and stays as it is).
UPDATE app.projects
SET external_item_id = regexp_replace(normalize(external_item_id, NFC),
                                      '^[[:space:]]+|[[:space:]]+$', '', 'g')
WHERE external_item_id IS NOT NULL
  AND external_item_id <> regexp_replace(normalize(external_item_id, NFC),
                                         '^[[:space:]]+|[[:space:]]+$', '', 'g')
  AND regexp_replace(normalize(external_item_id, NFC),
                     '^[[:space:]]+|[[:space:]]+$', '', 'g') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS projects_org_external_item_canonical
  ON app.projects (
    org_id,
    regexp_replace(normalize(external_item_id, NFC),
                   '^[[:space:]]+|[[:space:]]+$', '', 'g')
  )
  WHERE external_item_id IS NOT NULL;

-- Tasks: one ref per (project_id, canonical external_system, canonical
-- external_id). Per PROJECT, as 0059 chose: the same ref in two projects of
-- one organization is two tasks by design.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY project_id,
                        regexp_replace(normalize(external_system, NFC),
                                       '^[[:space:]]+|[[:space:]]+$', '', 'g'),
                        regexp_replace(normalize(external_id, NFC),
                                       '^[[:space:]]+|[[:space:]]+$', '', 'g')
           ORDER BY (external_system =
                       regexp_replace(normalize(external_system, NFC),
                                      '^[[:space:]]+|[[:space:]]+$', '', 'g')
                     AND external_id =
                       regexp_replace(normalize(external_id, NFC),
                                      '^[[:space:]]+|[[:space:]]+$', '', 'g')) DESC,
                    created_at_ms ASC,
                    id ASC
         ) AS keep_rank
  FROM app.tasks
  WHERE external_system IS NOT NULL AND external_id IS NOT NULL
)
UPDATE app.tasks t
SET external_system = NULL,
    external_id = NULL
FROM ranked
WHERE t.id = ranked.id AND ranked.keep_rank > 1;

UPDATE app.tasks
SET external_system = regexp_replace(normalize(external_system, NFC),
                                     '^[[:space:]]+|[[:space:]]+$', '', 'g'),
    external_id = regexp_replace(normalize(external_id, NFC),
                                 '^[[:space:]]+|[[:space:]]+$', '', 'g')
WHERE external_system IS NOT NULL AND external_id IS NOT NULL
  AND (external_system <> regexp_replace(normalize(external_system, NFC),
                                         '^[[:space:]]+|[[:space:]]+$', '', 'g')
    OR external_id <> regexp_replace(normalize(external_id, NFC),
                                     '^[[:space:]]+|[[:space:]]+$', '', 'g'))
  AND regexp_replace(normalize(external_system, NFC),
                     '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
  AND regexp_replace(normalize(external_id, NFC),
                     '^[[:space:]]+|[[:space:]]+$', '', 'g') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_external_canonical
  ON app.tasks (
    project_id,
    regexp_replace(normalize(external_system, NFC),
                   '^[[:space:]]+|[[:space:]]+$', '', 'g'),
    regexp_replace(normalize(external_id, NFC),
                   '^[[:space:]]+|[[:space:]]+$', '', 'g')
  )
  WHERE external_system IS NOT NULL AND external_id IS NOT NULL;
