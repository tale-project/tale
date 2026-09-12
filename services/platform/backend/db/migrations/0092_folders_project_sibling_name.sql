-- One project folder name per parent, case-folded, DB-enforced.
--
-- The folders service refuses a sibling whose name differs only in case
-- (`createFolder` / `renameFolder` compare `lower(name)`), but that rule was
-- a SELECT-then-INSERT in the service and nothing in the schema: two
-- concurrent get-or-creates of the same folder (a worker re-running its
-- setup step, two syncs filing into one folder) could both pass the check
-- and both insert. This index is that rule as the database remembers it;
-- the service's insert now arbitrates on it (`ON CONFLICT … DO NOTHING`)
-- and the loser re-reads the winner's row.
--
-- Scope: PROJECT folders only (`project_id IS NOT NULL`) — the Knowledge
-- Hub's folder tree keeps its own rules. A root folder has no parent, and
-- NULLs are distinct in a unique index, so the parent is folded through
-- `coalesce(parent_id, '')` (no NULLS NOT DISTINCT: it needs PG15, and a
-- BYO Postgres may be older).
--
-- Existing twins (only a lost race could have made one) are resolved
-- DETERMINISTICALLY before the index: per (org, project, parent,
-- lower(name)) group the OLDEST row — lowest created_at_ms, id as the
-- tiebreak — keeps its name; every newer duplicate is renamed with a
-- suffix built from its own id, so no folder, document or sync binding is
-- lost and the renamed row stays a valid folder name (under the 128-char
-- cap). Idempotent: a second run finds no group of two.
--
-- Rolling-deploy safe: the previous image's SELECT-then-INSERT keeps
-- working for every non-racing request; the formerly duplicating race
-- surfaces as a unique-violation error on the loser instead of a silent
-- duplicate until the new image takes over.

WITH ranked AS (
  SELECT id,
         name,
         row_number() OVER (
           PARTITION BY org_id, project_id, coalesce(parent_id, ''), lower(name)
           ORDER BY created_at_ms ASC, id ASC
         ) AS keep_rank
  FROM app.folders
  WHERE project_id IS NOT NULL
)
UPDATE app.folders
SET name = left(ranked.name, 100) || ' (' || left(ranked.id, 8) || ')'
FROM ranked
WHERE app.folders.id = ranked.id AND ranked.keep_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS folders_project_sibling_name
  ON app.folders (org_id, project_id, (coalesce(parent_id, '')), (lower(name)))
  WHERE project_id IS NOT NULL;
