-- Task labels keep their spelling and are unique per project without regard to case
--
-- A label used to be stored lower-cased — `Bug`, `P1`, `MixedCase-ÄÖÜ` came
-- back as `bug`, `p1`, `mixedcase-äöü` — because case-folding was the only
-- way `UNIQUE (project_id, name)` could keep `Bug` and `bug` from becoming two
-- labels. Every external system a mirror syncs from (Jira, GitHub, Linear,
-- Zendesk) treats label case as significant, so a mirror comparing what it
-- sent with what it read back re-synced every capitalised label forever.
--
-- The rule moves into the schema: a label's spelling is stored as first
-- given, and uniqueness is judged on `lower(name)` — the unique index below
-- is the rule the service's `ON CONFLICT (project_id, lower(name))` writes
-- against. Rows that already differ only in case (from before names were
-- case-folded at all) are collapsed first: the oldest row keeps its
-- spelling, every task's `label_ids` is repointed to it (order kept), the
-- others go — otherwise the index could not be created on that project.
--
-- Rolling-deploy safe: the previous image is still serving while this
-- applies, and its `ON CONFLICT (project_id, name)` needs the old constraint
-- to exist — so `task_labels_project_id_name_key` STAYS this release (a name
-- unique on `lower(name)` is unique on `name` too, so the two never
-- disagree). Retire it in a later release, once no image writes against it.

-- 1. Collapse case-variant duplicates onto the oldest row, repointing tasks.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY project_id, lower(name)
           ORDER BY created_at_ms ASC, id ASC
         ) AS keeper
  FROM app.task_labels
), dupes AS (
  SELECT id, keeper FROM ranked WHERE id <> keeper
)
UPDATE app.tasks t
SET label_ids = (
  SELECT coalesce(array_agg(v ORDER BY ord), '{}'::text[])
  FROM (
    SELECT DISTINCT ON (coalesce(d.keeper, u.x))
           coalesce(d.keeper, u.x) AS v, u.ord
    FROM unnest(t.label_ids) WITH ORDINALITY AS u(x, ord)
    LEFT JOIN dupes d ON d.id = u.x
    ORDER BY coalesce(d.keeper, u.x), u.ord
  ) s
)
WHERE EXISTS (
  SELECT 1 FROM unnest(t.label_ids) AS x JOIN dupes d ON d.id = x
);

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY project_id, lower(name)
           ORDER BY created_at_ms ASC, id ASC
         ) AS keeper
  FROM app.task_labels
)
DELETE FROM app.task_labels
WHERE id IN (SELECT id FROM ranked WHERE id <> keeper);

-- 2. The rule: one label per project per case-folded name.
CREATE UNIQUE INDEX IF NOT EXISTS task_labels_project_lower_name
  ON app.task_labels (project_id, lower(name));
