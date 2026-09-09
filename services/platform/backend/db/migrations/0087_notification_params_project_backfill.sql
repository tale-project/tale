-- Give stored task notifications the project their deep link needs.
--
-- A notification's link is not stored; both builders derive it from the row.
-- To open a task, `personalNotificationTarget` (the bell) and
-- `buildPersonalNotificationUrl` (the email) each need `task_id` AND
-- `params -> 'projectId'`. With only the task id the bell row falls back to
-- the org dashboard and the email loses its call to action entirely, so the
-- reader is told a task is overdue and left to go and find it by hand.
--
-- All three date rungs wrote `params` without the project, so every start,
-- due-soon and overdue row already in someone's bell is in that state. New
-- rows are fixed at the source — the emitters stamp it, the writer resolves
-- it from the task when a caller omits it, and `CollabNotificationInput`
-- no longer accepts `taskId` without it — but stored rows need this.
--
-- Set-based and idempotent: the `IS NULL` guard means a re-run after a
-- half-failed deploy touches nothing, and a row whose task has since been
-- deleted simply does not join. The join carries `org_id` on BOTH sides, so
-- a notification can never inherit a project from another tenant's task.
--
-- Rolling-deploy safe in both directions: the previous image reads `params`
-- as an opaque bag and ignores the added key, and the new image treats a
-- row without it exactly as before (the org-dashboard fallback).
UPDATE app.user_notifications n
SET params = coalesce(n.params, '{}'::jsonb)
             || jsonb_build_object('projectId', t.project_id)
FROM app.tasks t
WHERE n.task_id = t.id
  AND n.org_id = t.org_id
  AND n.params ->> 'projectId' IS NULL;
