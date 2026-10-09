-- How often each person's coding agent called Tale's MCP endpoint, per day:
-- one row per (organization, person, credential, method, tool, UTC day),
-- counted by the endpoint as each call is answered
-- (`backend/domains/mcp/activity.ts`).
--
-- It is the one source of "when did this agent last call", for API keys and
-- (later) OAuth connections alike: the connection status in the app reads it,
-- never a claim the client made. It counts and never records what a call
-- carried: no arguments, no results, no addresses. The writes an agent makes
-- are in the hash-chained audit log (`app.audit_logs`, stamped `via: mcp`);
-- this table is not evidence and is not chained.
--
-- `credential_id` is the API key's id (or an OAuth client's id), so one
-- person's two agents read as two rows. `client_name` is what the client
-- called itself on `initialize` — untrusted, display only, cleaned by
-- `displayClientName` (`lib/shared/client-name.ts`) and at most 80 characters.
-- `day` is the UTC date as yyyymmdd, so a row is one day's counters.
--
-- Retention: the daily `maintenance.mcp_activity_ttl` sweep deletes days
-- older than 90; an erasure deletes the person's rows; organization deletion
-- finds the table by its `org_id` column.
--
-- Rolling-deploy safe: a new table the previous image never touches.
CREATE TABLE IF NOT EXISTS app.mcp_client_activity (
  org_id text NOT NULL,
  user_id text NOT NULL,
  credential_kind text NOT NULL
    CHECK (credential_kind IN ('api-key', 'oauth')),
  credential_id text NOT NULL,
  -- The JSON-RPC method: 'initialize', 'ping', 'tools/list', 'tools/call', …
  -- (only the methods the endpoint serves are counted).
  method text NOT NULL,
  -- The tool a `tools/call` named, '' for every other method and for a name
  -- the inventory does not hold.
  tool text NOT NULL DEFAULT '',
  day integer NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  -- Calls answered with a refusal: a tool error the agent can read
  -- (arguments refused, a role refused, a budget spent) or a protocol error.
  refusals integer NOT NULL DEFAULT 0,
  -- Calls that failed unexpectedly (`INTERNAL_ERROR`).
  failures integer NOT NULL DEFAULT 0,
  client_name text
    CHECK (client_name IS NULL OR char_length(client_name) <= 80),
  last_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, user_id, credential_id, method, tool, day)
);

-- "The last call of each of my agents": a person's rows, newest first.
CREATE INDEX IF NOT EXISTS mcp_client_activity_recent
  ON app.mcp_client_activity (org_id, user_id, last_at_ms DESC);

-- The retention sweep deletes by day across every organization.
CREATE INDEX IF NOT EXISTS mcp_client_activity_day
  ON app.mcp_client_activity (day);
