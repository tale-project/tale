-- A person's assigned tasks, newest activity first, through an index of their
-- own.
--
-- Home's "assigned to me" reads the caller's open tasks across the projects
-- they can read, newest activity first, up to the board's cap
-- (`listTasksForAccessibleProjects` with `assigneeId`, in
-- `backend/domains/tasks/service.ts`). No index served that order for one
-- assignee: 0009's `tasks_assignee (org_id, assignee_type, assignee_id)` can
-- only bound the organization on Postgres 16 (no skip scan) and does not hold
-- `updated_at_ms`, so the read either walked `tasks_org_updated` through the
-- organization's tasks until it had a page of the person's, or read all of
-- them and sorted.
--
-- Partial: the board reads tasks that are not archived unless asked, and
-- writes that as the literal `t.archived_at_ms IS NULL`, which proves this
-- predicate in custom and generic plans alike. A read that includes archived
-- tasks keeps the plan it has today.
--
-- Plain CREATE INDEX: a migration runs in one transaction, so CONCURRENTLY is
-- unavailable; task writes wait for one pass over the tasks table while it
-- builds, and reads go on. Rolling-deploy safe: an index only, which the
-- previous image's reads may use as well.

CREATE INDEX IF NOT EXISTS tasks_org_assignee_updated
  ON app.tasks (org_id, assignee_id, updated_at_ms DESC)
  WHERE archived_at_ms IS NULL;
