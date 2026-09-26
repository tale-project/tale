-- Rotate source refresh attempts without changing Tale edits or source observations.
-- Missing legacy issues have no snapshot to advance syncedAt. Without a separate
-- attempt clock they occupy the oldest refresh slots forever and starve valid
-- linked issues. Selecting an authorized batch records its attempt even if the
-- upstream request later fails; the real snapshot clock remains untouched.
-- Nullable and unused by previous images, so old writers remain valid mid-roll.
ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS external_issue_refresh_attempted_at_ms bigint;

COMMENT ON COLUMN app.tasks.external_issue_refresh_attempted_at_ms IS
  'Last authorized issue-refresh batch selection, used only for fair retry ordering; independent of source syncedAt and local task updated_at_ms.';
