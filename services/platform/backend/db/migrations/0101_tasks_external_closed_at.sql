-- Tasks remember the external close a mirror parked them with.
--
-- An external system's `closed` — `POST /api/v1/projects/{id}/tasks` with
-- `externalState: "closed"`, the sandbox `task_upsert` — parks the task at
-- `in_review` (agents and mirrors never complete work; a person does; only
-- the workflow engine lands a close at `done`), while `open` used to reopen
-- a `done` task only. A mirror that closed an item and then reopened it
-- upstream left the card parked for good (2026-09-13 evaluation, E2-02):
-- the two values were not inverses, and only a person on the board could
-- move it. This stamp marks a park the MIRROR made: `open` lifts exactly
-- such a park back to the inbox and clears it, while a park a person or an
-- agent made (no stamp) stays theirs. Any status change through the
-- board's own doors clears it too — the mirror's ownership of the park
-- ends the moment someone else moves the card.
--
-- Nullable, no backfill: an existing park reads as a person's until the
-- next external close stamps it. Rolling-deploy safe: the previous image
-- neither reads nor writes the column.

ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS external_closed_at_ms bigint;
