-- One trigger per (org, name) — DB-enforced.
--
-- `setTrigger` (the editor's trigger door, REST PUT /automations/{name}/triggers,
-- the MCP set_trigger tool) used to bind with SELECT-then-INSERT over a plain
-- index (`automation_triggers_org_name`, 0019): two concurrent binds of one
-- name — two tabs, a retried request, MCP racing the UI — each saw "no row"
-- in READ COMMITTED and both inserted. The schedule scan then fired EVERY row
-- per occurrence (a double run), and a later edit or disable updated only the
-- LIMIT 1 row it happened to read, so the phantom stayed enabled and kept
-- starting live runs behind a switch that said "off". This file makes the
-- one-row rule one the database cannot forget; `setTrigger` now binds with a
-- single INSERT … ON CONFLICT (org_id, name) DO UPDATE, so N racing writers
-- converge on one row and the last commit wins, as sequential saves would.
--
-- Existing duplicates are resolved DETERMINISTICALLY before the index. Per
-- (org_id, name) group the row edited LAST — highest updated_at_ms, then
-- created_at_ms, then id — is the user's most recent intent (an edit or a
-- disable only ever landed on one row) and is kept with its configuration.
-- The group's newest fire stamp is merged onto it first, so the kept row does
-- not re-fire an occurrence a phantom already fired; the phantoms are then
-- deleted. Trigger rows are configuration, not history: a run references its
-- trigger only through the `trigger:<id>` text in started_by, and nothing
-- cascades from a trigger row.
--
-- Rolling-deploy safe: the previous image's SELECT-then-INSERT keeps working
-- for every non-racing bind; the formerly-duplicating race now surfaces as a
-- unique-violation error on the loser instead of a silent duplicate — the
-- safe side of the trade until the new image takes over.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, name
           ORDER BY updated_at_ms DESC, created_at_ms DESC, id DESC
         ) AS keep_rank,
         max(last_fired_at_ms) OVER (PARTITION BY org_id, name) AS newest_fire
  FROM app.automation_triggers
)
UPDATE app.automation_triggers AS t
SET last_fired_at_ms = ranked.newest_fire
FROM ranked
WHERE t.id = ranked.id
  AND ranked.keep_rank = 1
  AND ranked.newest_fire IS DISTINCT FROM t.last_fired_at_ms;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, name
           ORDER BY updated_at_ms DESC, created_at_ms DESC, id DESC
         ) AS keep_rank
  FROM app.automation_triggers
)
DELETE FROM app.automation_triggers AS t
USING ranked
WHERE t.id = ranked.id AND ranked.keep_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS automation_triggers_org_name_unique
  ON app.automation_triggers (org_id, name);

-- The unique index serves every (org_id, name) lookup the plain one did.
DROP INDEX IF EXISTS app.automation_triggers_org_name;
