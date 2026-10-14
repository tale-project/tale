-- A sandbox host is admitted into by the work it STARTS, but what presses it
-- comes later: a dependency install, an image build, a check of a whole
-- workspace or a full test suite inside a session that was admitted long
-- before. On 2026-09-29 five agent sessions, each let in while the host was
-- calm, drove a four-CPU host to a load of 94 with 3 GB free.
--
-- Before such a phase, a project agent's task run now asks the sandbox host
-- for a heavy-phase lease (`domains/sandbox/heavy-leases.ts`, the agent tool
-- `host_lease_acquire`), and waits while the host refuses one. The host keeps
-- its leases in memory, bound to the session; this table keeps the platform's
-- side: which run took which lease, so every lease a run still holds is
-- released when the run ends (settled, failed or cancelled), and an
-- administrator can see which run holds the host's heavy phases.
-- Organization-scoped like every row an organization owns; the organization
-- deletion walk removes them by `org_id`, and a run's rows go with the run.
CREATE TABLE IF NOT EXISTS app.sandbox_heavy_leases (
  -- The id the sandbox host gave the lease.
  lease_id text PRIMARY KEY,
  org_id text NOT NULL,
  -- The session the lease is held on: the run's own.
  session_id text NOT NULL,
  run_id text NOT NULL REFERENCES app.project_agent_runs (id) ON DELETE CASCADE,
  -- The execution of the run that asked; a run that is steered goes on under
  -- a new one and keeps its leases.
  exec_id text NOT NULL,
  -- What the agent said the phase is ("npm ci", "docker build").
  label text,
  -- What the phase said it would write to disk and hold in memory beside its
  -- session, as the host recorded it.
  predicted_growth_bytes bigint NOT NULL,
  memory_bytes bigint NOT NULL,
  acquired_at_ms bigint NOT NULL,
  -- The host ends the lease by itself at this time.
  expires_at_ms bigint NOT NULL,
  -- When the platform stopped counting the lease, and why: `released` (the
  -- agent released it), `run_ended` (its run ended) or `expired` (its expiry
  -- passed first). NULL while the run holds it.
  released_at_ms bigint,
  release_reason text
    CHECK (release_reason IN ('released', 'run_ended', 'expired')),
  CHECK ((released_at_ms IS NULL) = (release_reason IS NULL))
);

-- The leases a run still holds: read when the run ends, when it asks for
-- another, and by the sweep and the Sandboxes readback.
CREATE INDEX IF NOT EXISTS sandbox_heavy_leases_unreleased
  ON app.sandbox_heavy_leases (org_id, run_id)
  WHERE released_at_ms IS NULL;
