-- Every time a version of an automation became the live one: which version,
-- what was live before it, who made it live, through which door, key and
-- client, and when.
--
-- `app.automation_deployments` keeps only the current pointer (one row per
-- name, upserted), so the history a rollback chooses from was read back out
-- of the audit log — at most the last 20 deploys, and none the audit
-- retention had removed. This table is that history, kept as long as the
-- automation: removed with it (`deleteAutomationCascade`) and with its
-- organization (the teardown finds it by `org_id`). Rows are appended by the
-- deploy in its own transaction under the automation's name lock and never
-- updated.
--
-- `kind`: `deploy` puts a newer version live (or the first one), `rollback`
-- an older one, and `recorded` is a version found live without an event
-- saying how it got there — the pointer as this migration finds it, or a
-- deploy the previous image made while a new one rolled out (the next deploy
-- records it before its own). `actor` is the vocabulary of
-- `automations.created_by` (a user id, `api-key:<userId>`, `system:<what>`);
-- names are never stored. `via`, `api_key_id` and `client` are 0181's
-- vocabulary; NULL when the door is not known.
--
-- Backfill, idempotent (each row's id is derived from what it was read
-- from, so a second run inserts nothing):
--   1. every `automation.deployed` audit row of a name that was not deleted
--      after it — the history the audit log held;
--   2. one `recorded` row for each live pointer the newest event of its name
--      does not already say (same version, at or after the pointer's time).
-- Both are bounded by rows that exist (one per deploy kept, one per name).
--
-- Rolling-deploy safe: a new table the previous image never reads. A deploy
-- the previous image makes during the roll writes no event; the new image's
-- next deploy of that name records the pointer first.
CREATE TABLE IF NOT EXISTS app.automation_deployment_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  previous_version int CHECK (previous_version IS NULL OR previous_version >= 1),
  kind text NOT NULL CHECK (kind IN ('deploy', 'rollback', 'recorded')),
  actor text NOT NULL,
  via text CHECK (
    via IS NULL
    OR via IN ('app', 'upload', 'mcp', 'rest', 'managed', 'system')
  ),
  api_key_id text,
  client text CHECK (client IS NULL OR char_length(client) BETWEEN 1 AND 80),
  at_ms bigint NOT NULL
);

-- A history page, newest first, and "is the pointer recorded": both read
-- one name's newest events.
CREATE INDEX IF NOT EXISTS automation_deployment_events_name
  ON app.automation_deployment_events (org_id, name, at_ms DESC, id DESC);

-- 1. The deploys the audit log still holds. A row written before a later
--    `automation.deleted` of the same name belonged to an automation that no
--    longer exists ("later" in the order the name lock gave them: the
--    writing transaction's id, or the time for rows written before the
--    chain was sealed off the write path).
INSERT INTO app.automation_deployment_events (
  id, org_id, name, version, previous_version, kind, actor, via,
  api_key_id, client, at_ms
)
SELECT
  'audit:' || a.id,
  a.org_id,
  a.resource_id,
  (a.new_state->>'deployedVersion')::int,
  CASE
    WHEN a.previous_state->>'deployedVersion' ~ '^[1-9][0-9]{0,8}$'
      THEN (a.previous_state->>'deployedVersion')::int
  END,
  CASE
    WHEN a.previous_state->>'deployedVersion' ~ '^[1-9][0-9]{0,8}$'
      AND (a.new_state->>'deployedVersion')::int
        < (a.previous_state->>'deployedVersion')::int
      THEN 'rollback'
    ELSE 'deploy'
  END,
  CASE a.actor_type
    WHEN 'api' THEN 'api-key:' || a.actor_id
    ELSE a.actor_id
  END,
  CASE
    WHEN a.metadata->>'via' = 'mcp' THEN 'mcp'
    WHEN a.metadata->>'via' = 'api-key' THEN 'rest'
    WHEN a.actor_type = 'system' THEN 'system'
  END,
  a.metadata->>'apiKeyId',
  CASE
    WHEN char_length(a.metadata->>'clientName') BETWEEN 1 AND 80
      THEN a.metadata->>'clientName'
  END,
  a.ts
FROM app.audit_logs a
WHERE a.action = 'automation.deployed'
  AND a.resource_type = 'automation'
  AND a.resource_id IS NOT NULL
  AND a.new_state->>'deployedVersion' ~ '^[1-9][0-9]{0,8}$'
  AND NOT EXISTS (
    SELECT 1 FROM app.audit_logs d
    WHERE d.org_id = a.org_id
      AND d.action = 'automation.deleted'
      AND d.resource_type = 'automation'
      AND d.resource_id = a.resource_id
      AND CASE
        WHEN d.writer_xid IS NOT NULL AND a.writer_xid IS NOT NULL
          THEN d.writer_xid > a.writer_xid
        WHEN d.writer_xid IS NOT NULL THEN true
        WHEN a.writer_xid IS NOT NULL THEN false
        ELSE d.ts >= a.ts
      END
  )
ON CONFLICT (id) DO NOTHING;

-- 2. What is live today, where no event says so already.
INSERT INTO app.automation_deployment_events (
  id, org_id, name, version, previous_version, kind, actor, via, at_ms
)
SELECT
  'recorded:' || p.id || ':' || p.version || ':' || p.deployed_at_ms,
  p.org_id,
  p.name,
  p.version,
  NULL,
  'recorded',
  p.deployed_by,
  CASE WHEN p.deployed_by LIKE 'system:%' THEN 'system' END,
  p.deployed_at_ms
FROM app.automation_deployments p
WHERE NOT EXISTS (
  SELECT 1 FROM (
    SELECT e.version, e.at_ms
    FROM app.automation_deployment_events e
    WHERE e.org_id = p.org_id AND e.name = p.name
    ORDER BY e.at_ms DESC, e.id DESC
    LIMIT 1
  ) newest
  WHERE newest.version = p.version AND newest.at_ms >= p.deployed_at_ms
)
ON CONFLICT (id) DO NOTHING;
