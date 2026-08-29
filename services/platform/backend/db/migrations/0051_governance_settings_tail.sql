-- 0.5 app migration 0051: the governance settings tail — legal matters
-- (grouping for holds), the retention/DSAR pending-change stores (cooldown /
-- grace windows; applied LAZILY on read past their effective time, never by
-- cron), per-org guardrail secrets, and the chat-filter event telemetry the
-- Security page lists.
CREATE TABLE app.legal_matters (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  case_number text,
  description text,
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  closed_by text,
  closed_at_ms bigint
);
CREATE INDEX legal_matters_org_status ON app.legal_matters (org_id, status);

CREATE TABLE app.retention_policy_pending_changes (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL UNIQUE,
  applies_at_ms bigint NOT NULL,
  old_config jsonb NOT NULL,
  new_config jsonb NOT NULL,
  requested_by text NOT NULL,
  requested_at_ms bigint NOT NULL,
  summary text
);

CREATE TABLE app.dsar_policy_pending_changes (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL UNIQUE,
  pending_config jsonb NOT NULL,
  effective_at_ms bigint NOT NULL,
  proposed_by text NOT NULL,
  proposed_by_email text,
  proposed_at_ms bigint NOT NULL
);

CREATE TABLE app.governance_secrets (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  ciphertext text NOT NULL,
  nonce text NOT NULL,
  auth_tag text NOT NULL,
  key_fingerprint text NOT NULL,
  updated_at_ms bigint NOT NULL,
  updated_by text NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE app.chat_filter_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  sanitization_run_id text NOT NULL,
  thread_id text NOT NULL,
  message_id text,
  filter_name text NOT NULL CHECK (filter_name IN (
    'pii', 'chat_filter', 'moderation_provider'
  )),
  direction text NOT NULL CHECK (direction IN ('input', 'output')),
  kind text NOT NULL CHECK (kind IN (
    'detected', 'blocked', 'step_error', 'circuit_open'
  )),
  category_ids text[] NOT NULL DEFAULT '{}',
  match_count int,
  truncated boolean,
  error_class text,
  http_status int,
  duration_ms int,
  attempt int,
  agent_slug text,
  actor_type text,
  created_at_ms bigint NOT NULL
);
CREATE INDEX chat_filter_events_org_created
  ON app.chat_filter_events (org_id, created_at_ms DESC);

-- The bounds banner's dismissal memory (the 0.4 `rejectedBoundsHash`):
-- reappears when the operator's effective hash diverges from BOTH the
-- applied and the rejected hash.
ALTER TABLE app.retention_applied_bounds
  ADD COLUMN rejected_bounds_hash text;

ALTER TABLE app.gdpr_erasure_requests
  ADD COLUMN threads_targeted text[];

ALTER TABLE app.legal_hold_release_requests
  ADD COLUMN reject_reason text;
