-- When a failed agent run's automatic retry was armed.
--
-- A failed run either arms `task.agent_retry` — the turn host's failure door
-- (`failAgentRunFromTurn`) does for a failure a retry can change — or ends
-- for good: a code no retry changes, or a door that never arms one (the
-- deadline and capacity sweeps, a deleted agent, a schedule revoked before
-- launch). The task's run card says the agent could not finish only for the
-- second, and hides nothing behind a retry that is not coming. Reading that
-- off the failure code alone misread every run a non-arming door failed
-- without a code, and every row failed before those doors stamped one.
--
--   auto_retry_armed_at_ms  when this failed run's automatic retry was
--                           armed; NULL when none was — nothing starts the
--                           task again by itself. Set once, in the failing
--                           transaction. Whether the armed retry later
--                           started, waits, or was refused for good
--                           (`auto_retry_refused_at_ms`, migration 0141) is
--                           read from the rows that follow.
--
-- Rolling-deploy safe: a nullable column. The previous image neither reads
-- nor writes it; a run it fails reads as final, as runs failed before this
-- column do, until the armed retry's own run replaces it on the card.

ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS auto_retry_armed_at_ms bigint;
