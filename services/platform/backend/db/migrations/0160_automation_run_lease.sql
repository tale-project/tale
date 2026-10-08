-- A run's lease: which backend process steps it and until when, which engine
-- format its saved progress is in, and how often a restart handed it on.
--
-- A run used to carry only a claim epoch and a three-minute `wake_at_ms`
-- promise, and a claim took a `running` row unconditionally: a duplicate step
-- job or a sweep re-poke started a second walker on the same step, and the
-- epoch fence stopped the loser only after its effect. The lease names its
-- owner and lapses 30 s after the last heartbeat; a claim refuses a running
-- row whose lease is live, whoever holds it.
--
-- Rolling-deploy safe: every column is nullable or defaulted, and the
-- previous image names its columns in every read and insert. It claims
-- without stamping `lease_epoch`, so a row it claimed last has `lease_epoch`
-- <> `claim_epoch`, and the new claim then honours that image's `wake_at_ms`
-- promise instead of the lease. `ADD COLUMN … NOT NULL DEFAULT <constant>`
-- changes only the catalog; no row is rewritten.
ALTER TABLE app.automation_runs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at_ms bigint,
  ADD COLUMN IF NOT EXISTS lease_epoch int,
  ADD COLUMN IF NOT EXISTS resume_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resume_reason text
    CHECK (last_resume_reason IN ('shutdown', 'lease_expired')),
  ADD COLUMN IF NOT EXISTS last_resumed_at_ms bigint,
  ADD COLUMN IF NOT EXISTS engine_protocol int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS engine_version text;

COMMENT ON COLUMN app.automation_runs.lease_owner IS
  'host:pid:version:colour of the process stepping the run; NULL once released. Never sent to a client.';
COMMENT ON COLUMN app.automation_runs.lease_expires_at_ms IS
  'When the lease lapses unless renewed; NULL = released by a hand-off, a park or a finish';
COMMENT ON COLUMN app.automation_runs.lease_epoch IS
  'The claim_epoch the lease belongs to; differs from claim_epoch when an image without leases claimed last';
COMMENT ON COLUMN app.automation_runs.resume_count IS
  'How often another process took the run over (lease_expired) or a stopping one handed it on (shutdown)';
COMMENT ON COLUMN app.automation_runs.engine_protocol IS
  'Highest engine protocol that has stepped the run (lib/engine/core/protocol.ts); an older engine refuses it';
COMMENT ON COLUMN app.automation_runs.engine_version IS
  'TALE_VERSION of the engine that claimed the run last';

-- The drain count and the stalled read scan only running rows, by lease
-- expiry.
CREATE INDEX IF NOT EXISTS automation_runs_running_lease
  ON app.automation_runs (lease_expires_at_ms) WHERE status = 'running';
