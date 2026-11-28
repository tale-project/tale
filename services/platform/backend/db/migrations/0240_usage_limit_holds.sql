-- A subscription a run worked on reached its usage limit (Claude's five-hour
-- or weekly window, a ChatGPT plan's limit): the organization's runs on it
-- wait until it resets, or start on another device's sign-in. One row per
-- credential and device: a device's own sign-in (`device-login`) is held per
-- device, a pasted subscription token under the device ''.
-- domains/tasks/usage-limit-holds.ts reads and writes it; TASK-R87.
CREATE TABLE IF NOT EXISTS app.usage_limit_holds (
  org_id text NOT NULL,
  credential_id text NOT NULL,
  device_id text NOT NULL DEFAULT '',
  -- When the sign-in may be tried again, epoch ms: the reset the harness
  -- named, or a default wait when it named none (`reset_known` false).
  held_until_ms bigint NOT NULL,
  reset_known boolean NOT NULL DEFAULT false,
  recorded_at_ms bigint NOT NULL,
  -- The run whose turn met the limit, for the record.
  run_id text,
  PRIMARY KEY (org_id, credential_id, device_id)
);

CREATE INDEX IF NOT EXISTS usage_limit_holds_org_until
  ON app.usage_limit_holds (org_id, held_until_ms);

-- A parked run can wait for a sign-in's usage limit to reset, or for a
-- connected device that holds the sign-in to have room. The old image never
-- writes the new values and reads an unknown one as a generic wait.
ALTER TABLE app.project_agent_runs
  DROP CONSTRAINT IF EXISTS project_agent_runs_waiting_reason_check;
ALTER TABLE app.project_agent_runs
  ADD CONSTRAINT project_agent_runs_waiting_reason_check
    CHECK (waiting_reason IN (
      'org_limit', 'host', 'destroy_pending', 'exec_limit', 'model_capacity',
      'usage_limit', 'device_login'
    ));
