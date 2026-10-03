-- A failed run's automatic retry, retired for good (#3977).
--
-- The retry of a run an automation step or another agent started waits
-- while its agent works another task in the same workspace: the retry job
-- sends a later check of itself (`task.agent_retry_recheck`), and past its
-- bound the retry is refused, once, on the task's timeline
-- (`agent_run.refused`, `agent_busy`). That refusal is final for THIS failed
-- run, but pg-boss delivers at least once: the arm, a check queued before the
-- refusal, or the very job that refused can arrive again — after the agent
-- is free — and would pass every other guard and start the retry the
-- timeline said would not run. The mark lives on the failed run itself, so
-- every later delivery of its retry reads it under the same locks and
-- stands down.
--
--   auto_retry_refused_at_ms  when this failed run's automatic retry was
--                             refused for good; NULL while it may still
--                             start. Set once, in the refusal's own
--                             transaction (the refusal's timeline row is
--                             written only by the call that sets it).
--
-- Only this run's retry is retired: a newer run — a person's Start or Retry,
-- a manager's restart — is a new decision and starts as before, and its own
-- failure retries on its own.
--
-- Rolling-deploy safe: a nullable column. The previous image neither reads
-- nor writes it; its retry never waits, so it never needs the mark.

ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS auto_retry_refused_at_ms bigint;
