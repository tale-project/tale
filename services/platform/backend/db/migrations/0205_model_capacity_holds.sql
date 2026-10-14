-- A model at capacity is overloaded for every run on it, not for the one task
-- whose turn the provider refused. Until now each refused run failed on its
-- own, retried a minute later on its own, spent one of its three automatic
-- retries and one of its task's three automated starts an hour, and the next
-- start on the same model launched into the same refusal: a saturated model
-- emptied a fleet of agents and left their cards In progress with a failed run.
--
-- One row per (organization, provider, model) while the provider refuses it
-- (`domains/tasks/model-capacity-holds.ts`): every run on that model waits,
-- parked with the reason `model_capacity`, until `held_until_ms`; then ONE run
-- goes first (the probe) and the rest follow once it has proved the model
-- answers again — a run that settles, or a probe that has worked for two
-- minutes, clears the row. Each refusal that is new information (the probe's,
-- or one after the hold ran out) doubles the wait: 1, 2, 4, 8, then 15 minutes.
-- Organization-scoped like every row an organization owns; the organization
-- deletion walk removes them by `org_id`.
CREATE TABLE IF NOT EXISTS app.model_capacity_holds (
  org_id text NOT NULL,
  -- The run's `model_provider`, or '' when the run named none (one key for
  -- "the model this organization's default provider serves").
  model_provider text NOT NULL,
  model text NOT NULL,
  -- No run on the model starts before this, epoch ms.
  held_until_ms bigint NOT NULL,
  -- Refusals in a row that extended the hold; picks the next wait.
  consecutive integer NOT NULL DEFAULT 1 CHECK (consecutive >= 1),
  -- The first refusal of this streak: how long the model has been at capacity.
  first_refused_at_ms bigint NOT NULL,
  last_refused_at_ms bigint NOT NULL,
  -- The run whose refusal last extended the hold.
  last_run_id text,
  -- The run that went first once the hold ran out, and when it claimed that
  -- place; NULL while nobody probes. Only one run probes at a time.
  probe_run_id text,
  probe_claimed_at_ms bigint,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, model_provider, model)
);

-- A parked run can now wait for model capacity. The old image never writes
-- the new value and reads an unknown one as a generic wait.
ALTER TABLE app.project_agent_runs
  DROP CONSTRAINT IF EXISTS project_agent_runs_waiting_reason_check;
ALTER TABLE app.project_agent_runs
  ADD CONSTRAINT project_agent_runs_waiting_reason_check
    CHECK (waiting_reason IN (
      'org_limit', 'host', 'destroy_pending', 'exec_limit', 'model_capacity'
    ));
