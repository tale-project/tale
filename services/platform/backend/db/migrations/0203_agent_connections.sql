-- A coding agent a person connected to one organization by signing in on the
-- MCP endpoint (OAuth, `backend/auth/agent-oauth.ts`).
--
-- Better Auth owns the OAuth client, the consent and the tokens. This row is
-- the organization's own record of the grant: who connected which app, with
-- which access, and when and why it ended. The MCP door reads it on every
-- call, so ending a connection ends its access at once, whatever tokens the
-- agent still holds. When it was last used is not kept here: the endpoint
-- counts every call it answers (`app.mcp_client_activity`, credential kind
-- `oauth`, the connection's id), and that is the one source of "last used".
--
--   user_id            the person who connected it (a user id)
--   client_id          the app: its `oauthClient.clientId`, a URL for an app
--                      that identifies itself by a client metadata document
--   client_name        the app's name as the consent page showed it, cleaned
--                      of control and direction characters, at most 80 long
--   client_provenance  `metadata_document` (the app published its identity
--                      on its own HTTPS host) or `registered` (the app
--                      registered itself: unverified)
--   client_host        the verified host of a metadata document; NULL for an
--                      app that registered itself
--   redirect_host      where Tale sends the person back to, as the consent
--                      page showed it
--   scopes             the access the person allowed
--   created_at_ms      when the connection was made; a token minted before it
--                      belongs to an earlier connection of the same app and
--                      is refused
--   updated_at_ms      the last time the person allowed other access
--   revoked_*          when, by whom (a user id, or `system`) and why it ended
--
-- At most one connection of an app is live for a person in an organization;
-- ended ones stay as the history an admin can read, until the daily clean-up
-- removes the oldest. An organization's teardown removes every row of it
-- with the rest of its tables.
--
-- No foreign keys to Better Auth's tables: on a new database they are created
-- after these migrations. Rolling deploy: the previous image never reads the
-- table. No backfill.

CREATE TABLE IF NOT EXISTS app.agent_connections (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  client_id text NOT NULL,
  client_name text NOT NULL,
  client_provenance text NOT NULL
    CHECK (client_provenance IN ('metadata_document', 'registered')),
  client_host text,
  redirect_host text NOT NULL,
  scopes text[] NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  revoked_at_ms bigint,
  revoked_by text,
  revoke_reason text
    CHECK (revoke_reason IN (
      'user', 'admin', 'membership_ended', 'account_security',
      'refresh_reuse', 'client_removed'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_connections_live_uq
  ON app.agent_connections (org_id, user_id, client_id)
  WHERE revoked_at_ms IS NULL;

CREATE INDEX IF NOT EXISTS agent_connections_org_idx
  ON app.agent_connections (org_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS agent_connections_user_idx
  ON app.agent_connections (user_id)
  WHERE revoked_at_ms IS NULL;
