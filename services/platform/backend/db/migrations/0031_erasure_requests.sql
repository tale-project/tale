-- 0.5 app migration 0031: GDPR Art 17 erasure receipts — the durable,
-- queryable record of every erasure request: who filed it against whom,
-- the lawful ground, the 30-day SLA (single Art 12(3) extension), the
-- cooling-off window before the cascade runs, and the outcome counts.
-- A hold-blocked request is a RECEIPT too ('blocked'): the regulator can
-- see it was received and refused under Art 17(3)(e).

CREATE TABLE app.gdpr_erasure_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  target_user_id text NOT NULL,
  reason text NOT NULL,
  reason_code text NOT NULL,
  requested_by text NOT NULL,
  requested_at_ms bigint NOT NULL,
  sla_deadline_at_ms bigint NOT NULL,
  extension_granted_at_ms bigint,
  extension_granted_by text,
  extension_reason text,
  extension_deadline_at_ms bigint,
  status text NOT NULL CHECK (status IN (
    'pending', 'running', 'done', 'partial', 'failed', 'blocked', 'cancelled'
  )),
  effective_at_ms bigint,
  cancelled_by text,
  cancellation_reason text,
  started_at_ms bigint,
  finished_at_ms bigint,
  -- {threads, documents, rows-by-table…} outcome counts + failures.
  counts jsonb,
  error text
);

CREATE INDEX gdpr_erasure_requests_org
  ON app.gdpr_erasure_requests (org_id, requested_at_ms DESC);
CREATE UNIQUE INDEX gdpr_erasure_one_live_per_subject
  ON app.gdpr_erasure_requests (org_id, target_user_id)
  WHERE status IN ('pending', 'running');
