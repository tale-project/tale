-- 0.5 app migration 0020: the governance usage ledger — period-bucketed
-- aggregates (daily/weekly/monthly) per (org, user, team, agent, model,
-- api key, connector), upserted atomically per billable call. The budget
-- rules read these buckets; the analytics pages break them down.

CREATE TABLE app.usage_ledger (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  team_id text,
  period_key text NOT NULL,
  granularity text NOT NULL CHECK (granularity IN ('daily', 'weekly', 'monthly')),
  agent_slug text,
  model text,
  provider text,
  api_key_id text,
  connector_name text,
  connector_operation text,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  cost_estimate_cents double precision NOT NULL DEFAULT 0,
  request_count int NOT NULL DEFAULT 0,
  connector_call_count int NOT NULL DEFAULT 0,
  audio_duration_sec double precision,
  character_count bigint,
  updated_at_ms bigint NOT NULL
);

-- The upsert key. NULL dimensions coalesce to '' so a keyless bucket is one
-- row (PG treats NULLs as distinct in a plain unique constraint).
CREATE UNIQUE INDEX usage_ledger_bucket ON app.usage_ledger (
  org_id, user_id, period_key,
  coalesce(team_id, ''), coalesce(agent_slug, ''), coalesce(model, ''),
  coalesce(api_key_id, ''), coalesce(connector_name, ''),
  coalesce(connector_operation, '')
);

CREATE INDEX usage_ledger_org_period
  ON app.usage_ledger (org_id, period_key);
