-- Why a run got its runtime: the reason a kick decided, kept for its later
-- turns.
--
-- 0240 records on each turn's op why the turn runs on its harness. Hosts
-- read that rule again whenever a turn of a run opened an op, and so told
-- some turns wrong: an answered question's resume of a step that began on
-- Claude Code while it was the default read as "the default runtime" once
-- Pi was, and a steer's restart or a later start of a task run read the
-- standard-agent policy as it stood then. The reason is now decided once,
-- where the runtime is chosen — the automation step's kick keeps it on the
-- run's cursor, the task run's kick on the run — and every later turn of the
-- run records what the kick decided:
--
--   app.project_agent_runs.harness_reason
--       why the run's harness was chosen when it was kicked: `pinned` (the
--       agent names its runtime), `policy` (the standard-agent policy pins
--       one), `default`, `subscription_bound` or `model_bound` (the standard
--       agent chose for itself). NULL on a run an image before this one
--       kicked: its turns record no reason rather than a guessed one.
--
-- The reasons gain `model_bound`: nothing named a runtime, and the default
-- runtime cannot run the model — its tools work only on an API the default
-- does not speak (a model whose tools need the Responses API runs on Codex) —
-- so the turn runs on a runtime that can. `default` is recorded only for the
-- default runtime itself.
--
-- Rolling deploy: the previous image neither reads nor writes the run's
-- column, and never writes `model_bound`; its readers drop a reason they do
-- not know, so a turn it shows that the new image recorded `model_bound`
-- says nothing about its runtime. Both checks are added NOT VALID: the op
-- rows already satisfy the narrower rule 0240 checked, the run rows are all
-- NULL, and validating either would scan a table the previous image keeps
-- writing while this applies.

ALTER TABLE app.sandbox_session_ops
  DROP CONSTRAINT IF EXISTS sandbox_session_ops_harness_reason_known,
  ADD CONSTRAINT sandbox_session_ops_harness_reason_known
    CHECK (harness_reason IN (
      'pinned', 'default', 'subscription_bound', 'policy', 'model_bound'
    )) NOT VALID;

ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS harness_reason text;

ALTER TABLE app.project_agent_runs
  DROP CONSTRAINT IF EXISTS project_agent_runs_harness_reason_known,
  ADD CONSTRAINT project_agent_runs_harness_reason_known
    CHECK (harness_reason IN (
      'pinned', 'default', 'subscription_bound', 'policy', 'model_bound'
    )) NOT VALID;
