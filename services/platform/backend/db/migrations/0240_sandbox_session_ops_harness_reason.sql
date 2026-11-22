-- Why each sandbox agent turn runs on its harness.
--
-- Every harness turn of both lanes opens an op row, and since 0127 the row
-- records the harness the turn runs on. When nobody names a runtime the
-- platform chooses one, by one of several rules — and with the default
-- runtime moving from Claude Code to Pi (tale-project/tale#4942) a person
-- reading a run has to be able to tell which rule put the turn where it
-- ran: an organization whose only credentials for a model are a Claude
-- subscription keeps running in Claude Code, and says why. The host that
-- opens the op knows the rule it applied; this column keeps it, and the
-- run's details read it beside the harness:
--
--  - `pinned`: the agent, or the automation step, names its runtime;
--  - `default`: nothing named one, so the turn runs on the default runtime;
--  - `subscription_bound`: nothing named one, and the only credentials that
--    serve the model work in one runtime alone (a Claude subscription in
--    Claude Code), so the turn runs there;
--  - `policy`: the standard-agent policy pins the runtime.
--
-- NULL on a row written before this column, and on one the watchdog creates
-- for a turn whose host never opened it: its claim does not know the rule.
-- No backfill — which default applied, and which credentials served a model,
-- when a past turn ran is not recorded anywhere. The CHECK holds the four
-- values; a new rule widens it in the migration that ships the rule.
-- Rolling-deploy safe: a nullable column the previous image neither writes
-- nor reads.

ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS harness_reason text
    CONSTRAINT sandbox_session_ops_harness_reason_known
    CHECK (harness_reason IN (
      'pinned', 'default', 'subscription_bound', 'policy'
    ));
