-- The OAuth2 authorization-code flow for connectors.
--
-- `state` is a bearer token in the user's browser; the row stores only its
-- SHA-256 (the 0.4 posture), so a database reader cannot replay a pending
-- authorization. Single-use is enforced by DELETE … RETURNING in one
-- statement — two replayed callbacks cannot both observe the row.
CREATE TABLE app.connector_oauth_states (
  state_hash text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  connector_slug text NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  created_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL
);

-- The mint sweeps a bounded page of expired rows, so the table stays bounded
-- without a cron (abandoned consent screens are never consumed).
CREATE INDEX connector_oauth_states_expires
  ON app.connector_oauth_states (expires_at_ms);

-- A Slack workspace routes inbound events to exactly ONE organization. The
-- 0.4 "take two and refuse an ambiguous route" defence becomes an invariant
-- the database keeps: team_id is the primary key, so a second organization
-- cannot claim a workspace at all.
CREATE TABLE app.connector_team_routes (
  team_id text PRIMARY KEY,
  org_id text NOT NULL,
  credential_id text NOT NULL
    REFERENCES app.connector_credentials (id) ON DELETE CASCADE,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX connector_team_routes_org
  ON app.connector_team_routes (org_id);
