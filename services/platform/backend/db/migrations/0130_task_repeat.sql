-- Repeating tasks: the rule a task repeats on, the copy that continues it,
-- and the scan that continues a series on its due date.
--
-- A task may carry a repeat rule (`lib/shared/task-repeat.ts`: daily, weekly
-- on chosen weekdays, monthly on a day, yearly on a date, every N of them, in
-- the zone of the person who set it). The series continues on its own cards:
-- ONE next copy is created in To do with its dates stepped to the rule's next
-- occurrence, carrying the same rule, and the series goes on from there. The
-- rule's `createOn` says when:
--
--   close    (the default; the key is then absent) when the task moves from
--            an open column to Done or Cancelled — a series nobody works
--            never piles up copies.
--   dueDate  that too, and at the start of the due date (midnight in the
--            rule's zone) if the task is still open then — for work owed
--            every period whether or not the last one was finished. A job
--            (`tasks.repeat_on_due`, every five minutes) finds such tasks
--            and continues them; the task itself stays open. It never lets
--            more than ten open copies of one series pile up.
--
-- The copy brings the task's subtasks back with it (fresh, in To do, dated
-- by the same step, with the dependencies between them) and the people who
-- watched the task; subtasks never carry a rule of their own.
--
-- `repeat_continued_at_ms` is the task's record that it has continued its
-- series: the lane that creates the copy stamps it in the same UPDATE that
-- names the copy, under the task's row lock, and a reopen and re-close — or
-- the next scan — finds it set and creates nothing. Nothing ever clears
-- it: not the copy's delete, not "Stop repeating". So deleting the newest
-- task of a series ends the series — the task before it never continues
-- again — and deleting a copy in the middle never forks the series into
-- two.
--
-- `repeat_next_task_id` names that copy: what the task's sheet reads to
-- link "Next task", and what "Stop repeating" follows forward through the
-- series. Deleting the copy (or "Stop repeating" taking back one nobody has
-- touched) clears the pointer (ON DELETE SET NULL) rather than leaving it
-- dangling — which is why it cannot also be the record above; the partial
-- index serves that clear, so a copy's delete never scans the table, and
-- its uniqueness says what the writer guarantees — a copy continues exactly
-- one task.
--
-- `tasks_repeat_on_due` holds exactly the tasks the due-date scan can
-- continue — open, top level, not archived, not continued yet, `createOn`
-- set to `dueDate` — ordered by due date, so the scan reads the few that
-- are due instead of every task with a due date. Its predicate is repeated
-- verbatim by the scan's query (`backend/domains/tasks/repeat-on-due.ts`),
-- which is what lets the planner use it.
--
-- A watcher carried over to the copy is recorded with the reason `repeat`,
-- so the subscription's closed set of reasons gains it.
--
-- Rolling-deploy safe: the columns are nullable with no backfill, the
-- indexes only cover rows with a pointer or a rule, and the widened CHECK
-- accepts every reason the previous image writes. The previous image
-- neither reads nor writes the columns and never writes the new reason: a
-- close it handles mid-roll simply does not repeat, and the rule stays on
-- the closed task, so reopening and closing it again once the new image
-- serves creates the copy then; a task due mid-roll is continued by the
-- first scan the new image runs.

ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS repeat_rule jsonb
    CHECK (repeat_rule IS NULL OR jsonb_typeof(repeat_rule) = 'object'),
  ADD COLUMN IF NOT EXISTS repeat_next_task_id text
    REFERENCES app.tasks (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repeat_continued_at_ms bigint;

COMMENT ON COLUMN app.tasks.repeat_rule IS
  'The repeat rule this task carries ({frequency, interval, weekdays|monthDay|month, timezone, createOn?}, validated by taskRepeatSchema; createOn is present only as ''dueDate''), or NULL when it does not repeat. Read leniently: a rule that no longer validates reads as none.';
COMMENT ON COLUMN app.tasks.repeat_next_task_id IS
  'The next copy that continues this task''s series (created by its close, or by the due-date scan), set once. NULL until then, and again when the copy is deleted; whether the task continued its series is repeat_continued_at_ms, which outlives the copy.';
COMMENT ON COLUMN app.tasks.repeat_continued_at_ms IS
  'When this task continued its series: stamped with repeat_next_task_id, in the same write, and never cleared (not by the copy''s delete, not by Stop repeating). A task with a stamp never creates another copy, so deleting the newest task of a series ends it and deleting a middle copy never forks it. NULL while the task has not continued its series.';

CREATE UNIQUE INDEX IF NOT EXISTS tasks_repeat_next_task
  ON app.tasks (repeat_next_task_id)
  WHERE repeat_next_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_repeat_on_due
  ON app.tasks (due_date_ms, id)
  WHERE repeat_continued_at_ms IS NULL
    AND archived_at_ms IS NULL
    AND parent_task_id IS NULL
    AND status NOT IN ('done', 'cancelled')
    AND (repeat_rule ->> 'createOn') = 'dueDate';

-- The reasons a subscription records gain `repeat` (0028 named the column's
-- CHECK implicitly; the name below is the one Postgres gave it).
ALTER TABLE app.task_subscriptions
  DROP CONSTRAINT IF EXISTS task_subscriptions_reason_check;
ALTER TABLE app.task_subscriptions
  ADD CONSTRAINT task_subscriptions_reason_check
    CHECK (reason IN (
      'creator', 'assignee', 'commenter', 'mention', 'reviewer', 'manual',
      'repeat'
    ));
