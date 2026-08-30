-- 0.5 app migration 0003: the tamper-evident audit chain.
--
-- One chain per organization. The 0.4 implementation forced serialization
-- with a Convex OCC genesis-sentinel trick; in Postgres the chain head is a
-- real row locked with SELECT … FOR UPDATE (constitution rule 5), which
-- makes forks impossible by construction. `chainSuccessor` from 0.4 is
-- dropped — it existed only to force OCC contention.

CREATE TABLE app.audit_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,

  actor_id text NOT NULL,
  actor_email text,
  actor_email_hash text,
  actor_role text,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'api', 'workflow')),

  action text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'auth', 'member', 'data', 'connector', 'integration', 'workflow',
    'security', 'admin', 'ai', 'skill', 'agent'
  )),

  resource_type text NOT NULL,
  resource_id text,
  resource_name text,

  previous_state jsonb,
  new_state jsonb,
  changed_fields text[],

  session_id text,
  ip_address text,
  actor_ip_hash text,
  user_agent text,
  request_id text,

  -- Epoch milliseconds, app-clamped monotonic per org (chain sort key).
  ts bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failure', 'denied')),
  error_message text,
  metadata jsonb,

  integrity_hash text NOT NULL,
  previous_hash text,

  -- GDPR Art 17 scrub marker (see 0.4 schema comment); scrubbed rows no
  -- longer recompute — verify walks consult the pii_scrub checkpoint.
  pii_scrubbed boolean,
  pii_scrubbed_at bigint,

  -- Retention soft-delete lifecycle (reaped rows stay chain-verifiable).
  lifecycle_status text,
  status_changed_at bigint,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_org_ts ON app.audit_logs (org_id, ts DESC);
CREATE INDEX audit_logs_org_category_ts ON app.audit_logs (org_id, category, ts DESC);
CREATE INDEX audit_logs_org_actor_ts ON app.audit_logs (org_id, actor_id, ts DESC);
CREATE INDEX audit_logs_org_resource ON app.audit_logs (org_id, resource_type, resource_id, ts DESC);

-- Per-org chain head: last hash + last (clamped) timestamp. Every append
-- locks this row FOR UPDATE, so appends serialize per org and the inline
-- prior-row self-check always sees the true head.
CREATE TABLE app.audit_chain_heads (
  org_id text PRIMARY KEY,
  last_hash text NOT NULL DEFAULT '',
  last_ts bigint NOT NULL DEFAULT 0
);
