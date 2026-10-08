-- What one project spent, per period: the bucket a `project` budget rule is
-- measured against (`domains/governance/budget-gate.ts`).
--
-- Every booking that names a project lands here beside its
-- `app.usage_ledger` row, through the ledger's one writer
-- (`incrementUsageLedger`, `domains/governance/service.ts`): a chat turn in
-- one of the project's threads, a turn of one of its agents or of an
-- automation run in it, and a call made with the project's own API key. A
-- run of an automation bound to several projects, naming none of them,
-- books into each project's buckets.
-- A table of its own rather than a ledger column: the ledger's upsert infers
-- its conflict target from a unique index the previous image still writes
-- against, so a new dimension there cannot land mid-roll.
--
-- No person is named here, so erasure has nothing to remove; retention ages
-- the rows on the ledger's own clock, and deleting the organization deletes
-- them with every other row it keyed.
--
-- `sandbox_session_ops.project_ids` stamps the projects on a managed turn's
-- or a model-endpoint request's hold, so an admission counts each project's
-- work still in flight — every project an automation is bound to, for a run
-- that names none, as such a run's spend counts toward each of them.
--
-- Rolling-deploy safe: a new table and a nullable column the previous image
-- never reads. Spend the previous image books during the roll names no
-- project, so a project's period that spans the deploy undercounts it.

CREATE TABLE IF NOT EXISTS app.project_usage (
  org_id text NOT NULL,
  project_id text NOT NULL,
  granularity text NOT NULL
    CHECK (granularity IN ('daily', 'weekly', 'monthly')),
  -- The period the granularity names (`2026-10-07`, `2026-W41`, `2026-10`).
  period_key text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  cost_estimate_cents double precision NOT NULL DEFAULT 0,
  request_count bigint NOT NULL DEFAULT 0,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, project_id, period_key)
);

-- Retention ages buckets by their last booking.
CREATE INDEX IF NOT EXISTS project_usage_org_updated
  ON app.project_usage (org_id, updated_at_ms);

ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS project_ids text[];
