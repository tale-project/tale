-- Keep source state and immutable vendor identity separate from Tale triage.
-- A repository/project rename changes the display reference and permalink,
-- never which task represents the issue. Refreshing source status/title/body
-- must not close a Tale task or overwrite a person's task edits.
-- Both columns are nullable so the previous image keeps writing mid-roll;
-- legacy references acquire their stable identity on the first source refresh.
ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS external_source_id text,
  ADD COLUMN IF NOT EXISTS external_issue jsonb;

COMMENT ON COLUMN app.tasks.external_source_id IS
  'Vendor-stable source identity, scoped to organization, project and external system; independent of external_id display locator.';
COMMENT ON COLUMN app.tasks.external_issue IS
  'Validated upstream issue snapshot, including source state and last observation time; never the Tale task lifecycle.';

CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_external_source_unique
  ON app.tasks (org_id, project_id, external_system, external_source_id)
  WHERE external_system IS NOT NULL AND external_source_id IS NOT NULL;
