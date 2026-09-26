-- Retain tracked source scopes when issues move between repositories or projects.
-- The canonical source snapshot follows each move; remembering the scopes that
-- already tracked the task keeps their subsequent syncs observing resolution.
-- Scope IDs are meaningful only inside the task's organization, Tale project,
-- external system and (for GlitchTip) instance. This bookkeeping is not source
-- content or local task activity. Nullable for old writers during a rolling deploy;
-- authorized refresh selections also populate it before legacy source hydration.
ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS external_issue_source_scopes text[];

COMMENT ON COLUMN app.tasks.external_issue_source_scopes IS
  'Observed or authorized refresh repository/project IDs retained across source transfers; internal scheduling metadata, scoped by the task and source instance.';
