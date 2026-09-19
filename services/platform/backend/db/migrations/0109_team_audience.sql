-- Team audience: ONE vocabulary for who may see a document, a folder or a
-- project — `team_ids`/`team_tags`, an ordered set of team ids whose EMPTY
-- value means organization-wide.
--
-- Before this file three shapes coexisted: documents and folders carried a
-- `team_id` mirror beside `team_tags`, projects carried an owning `team_id`
-- beside `shared_with_team_ids`, and the readers disagreed about which
-- column won when the two drifted (a row with `team_id` set and an empty
-- `team_tags` read as organization-wide on one door and as team-only on the
-- next). The application now reads the ARRAY only — `team_tags` on documents
-- and folders, the new `team_ids` on projects — and keeps writing the legacy
-- columns as derived mirrors (`team_id = arr[1]`, `shared_with_team_ids =
-- arr[2:]`) so the previous image keeps working while this rolls out. The
-- mirrors go in a later release, once nothing reads them.
--
-- Idempotent by construction: every statement is `IF NOT EXISTS` or an
-- `UPDATE` whose WHERE matches nothing once the row is in its target state.
-- Re-running this file any number of times is a no-op — no `updated_at_ms`
-- moves (a repair is not an edit; `DOCUMENT_STALE` relies on that stamp),
-- nothing is emitted.
--
-- Rolling-deploy safe: the previous image is still serving while this applies.

-- ── Projects: the audience array beside the two legacy columns ─────────────
ALTER TABLE app.projects
  ADD COLUMN IF NOT EXISTS team_ids text[] NOT NULL DEFAULT '{}';

-- Backfill from the legacy pair: the owning team first, then the shared
-- teams, NULL dropped and duplicates collapsed while keeping first-seen
-- order. Only rows still at the default are touched, so a re-run (or a row
-- the new code already wrote) is left alone.
UPDATE app.projects p
   SET team_ids = ARRAY(
         SELECT u.t
           FROM unnest(array_remove(ARRAY[p.team_id] || p.shared_with_team_ids, NULL))
                WITH ORDINALITY AS u(t, ord)
          GROUP BY u.t
          ORDER BY min(u.ord)
       )
 WHERE cardinality(p.team_ids) = 0
   AND (p.team_id IS NOT NULL OR cardinality(p.shared_with_team_ids) > 0);

-- ── Documents and folders: the array is authoritative ──────────────────────
-- A row stamped only through the legacy single column becomes what every
-- SQL door already treated it as: restricted to that one team.
UPDATE app.documents
   SET team_tags = ARRAY[team_id]
 WHERE team_id IS NOT NULL AND cardinality(team_tags) = 0;
UPDATE app.folders
   SET team_tags = ARRAY[team_id]
 WHERE team_id IS NOT NULL AND cardinality(team_tags) = 0;

-- Re-derive the mirrors from the arrays (`arr[1]` of an empty array is NULL).
UPDATE app.documents
   SET team_id = team_tags[1]
 WHERE team_id IS DISTINCT FROM team_tags[1];
UPDATE app.folders
   SET team_id = team_tags[1]
 WHERE team_id IS DISTINCT FROM team_tags[1];
UPDATE app.projects
   SET team_id = team_ids[1],
       shared_with_team_ids = team_ids[2:]
 WHERE team_id IS DISTINCT FROM team_ids[1]
    OR shared_with_team_ids IS DISTINCT FROM team_ids[2:];

-- ── One-time ghost cleanup ─────────────────────────────────────────────────
-- The scope columns have no FK to Better Auth's "team" table, and until now a
-- folder or an import could be stamped with an id that was never one of this
-- organization's teams. Team deletion is atomic from here on (one transaction
-- retires every scope beside the team row) and every write door validates
-- the ids it is handed, so this sweep is the last one — the daily
-- `teams.repair_scopes` job it replaces is gone.
--
-- Guarded: app migrations apply BEFORE Better Auth creates its tables on a
-- fresh database (`backend/db/migrate.ts`), and on a fresh database there is
-- nothing to clean. Each statement matches nothing once the arrays are clean,
-- so this block is a no-op on every later run.
DO $$
BEGIN
  IF to_regclass('"team"') IS NOT NULL THEN
    UPDATE app.documents d
       SET team_tags = ARRAY(
             SELECT u.t FROM unnest(d.team_tags) WITH ORDINALITY AS u(t, ord)
              WHERE EXISTS (SELECT 1 FROM "team" t
                             WHERE t."id" = u.t AND t."organizationId" = d.org_id)
              ORDER BY u.ord)
     WHERE EXISTS (SELECT 1 FROM unnest(d.team_tags) AS u(t)
                    WHERE NOT EXISTS (SELECT 1 FROM "team" t
                                       WHERE t."id" = u.t AND t."organizationId" = d.org_id));
    UPDATE app.folders f
       SET team_tags = ARRAY(
             SELECT u.t FROM unnest(f.team_tags) WITH ORDINALITY AS u(t, ord)
              WHERE EXISTS (SELECT 1 FROM "team" t
                             WHERE t."id" = u.t AND t."organizationId" = f.org_id)
              ORDER BY u.ord)
     WHERE EXISTS (SELECT 1 FROM unnest(f.team_tags) AS u(t)
                    WHERE NOT EXISTS (SELECT 1 FROM "team" t
                                       WHERE t."id" = u.t AND t."organizationId" = f.org_id));
    UPDATE app.projects p
       SET team_ids = ARRAY(
             SELECT u.t FROM unnest(p.team_ids) WITH ORDINALITY AS u(t, ord)
              WHERE EXISTS (SELECT 1 FROM "team" t
                             WHERE t."id" = u.t AND t."organizationId" = p.org_id)
              ORDER BY u.ord)
     WHERE EXISTS (SELECT 1 FROM unnest(p.team_ids) AS u(t)
                    WHERE NOT EXISTS (SELECT 1 FROM "team" t
                                       WHERE t."id" = u.t AND t."organizationId" = p.org_id));

    -- Mirrors follow the cleaned arrays.
    UPDATE app.documents
       SET team_id = team_tags[1]
     WHERE team_id IS DISTINCT FROM team_tags[1];
    UPDATE app.folders
       SET team_id = team_tags[1]
     WHERE team_id IS DISTINCT FROM team_tags[1];
    UPDATE app.projects
       SET team_id = team_ids[1],
           shared_with_team_ids = team_ids[2:]
     WHERE team_id IS DISTINCT FROM team_ids[1]
        OR shared_with_team_ids IS DISTINCT FROM team_ids[2:];

    -- A queue or an import scope pointing at a team that is not this
    -- organization's goes back to unassigned / organization-wide.
    UPDATE app.conversations c
       SET assignee_team_id = NULL
     WHERE c.assignee_team_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "team" t
                        WHERE t."id" = c.assignee_team_id AND t."organizationId" = c.org_id);
    UPDATE app.onedrive_sync_configs s
       SET team_id = NULL
     WHERE s.team_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "team" t
                        WHERE t."id" = s.team_id AND t."organizationId" = s.org_id);
    UPDATE app.google_drive_sync_configs s
       SET team_id = NULL
     WHERE s.team_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "team" t
                        WHERE t."id" = s.team_id AND t."organizationId" = s.org_id);
  END IF;
END $$;

-- ── Per-team lookups ───────────────────────────────────────────────────────
-- The list doors are driven by `org_id` (their `cardinality(...) = 0 OR ...`
-- disjunction defeats any array index); these serve the per-team lanes —
-- scope retirement and the delete-impact preview — which ask `arr @> ARRAY[$1]`.
CREATE INDEX IF NOT EXISTS documents_team_tags_gin
  ON app.documents USING gin (team_tags);
CREATE INDEX IF NOT EXISTS folders_team_tags_gin
  ON app.folders USING gin (team_tags);
CREATE INDEX IF NOT EXISTS projects_team_ids_gin
  ON app.projects USING gin (team_ids);
