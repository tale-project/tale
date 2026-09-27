-- Tasks assigned to a project agent that no longer exists.
--
-- `app.tasks.assignee_id` is polymorphic (a user id, a project-agent id or an
-- automation name, by `assignee_type`), so it carries no foreign key, and
-- deleting a project agent (`deleteProjectAgent`) left every task that named
-- it "assigned" to a raw id: the board showed the UUID as the assignee, the
-- timeline labelled the agent's activity with it, and Retry re-kicked a run
-- for an agent that could not exist. The delete now clears those assignments
-- in its own transaction; this backfill clears the rows deleted before it did.
--
-- The task keeps everything else — runs, comments, activity — exactly as the
-- docs promise ("clears task assignment references while preserving task
-- history"). No activity line is written for a backfilled row: there is no
-- actor to attribute it to, and the timeline already reads a missing agent
-- as "Deleted agent".
--
-- Idempotent and bounded: a re-run finds nothing to clear. Rolling-deploy
-- safe: the previous image reads a NULL assignee as "unassigned" already.

UPDATE app.tasks t SET
  assignee_type = NULL,
  assignee_id = NULL,
  updated_at_ms = (extract(epoch FROM now()) * 1000)::bigint
WHERE t.assignee_type = 'agent'
  AND t.assignee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM app.project_agents a
    WHERE a.id = t.assignee_id AND a.org_id = t.org_id
  );
