-- Organization-owned trusted-header keys: the credential an application's
-- authenticating proxy presents on the trusted-headers door.
--
-- The door (`GET /api/trusted-headers/authenticate`) used to be a
-- deployment-wide MODE: one env switch, one env secret, and every proxy
-- sign-in landing in the earliest organization that had an owner or admin.
-- That shape cannot serve a deployment with several organizations, where a
-- hosting application must sign its users into ITS organization and nothing
-- else. So the credential becomes organization data, in the shape the SCIM
-- token already has (`app.sso_connections.scim_token_hash`): a random bearer
-- value answered once, only its SHA-256 hash stored, the organization
-- resolved FROM the key — never from a header, a body or a path — plus an
-- organization-level switch that pauses the door without discarding keys.
--
-- Rolling-deploy safe: two new tables, nothing existing changes.

CREATE TABLE app.trusted_header_settings (
  -- One row per organization (Better Auth organization id).
  org_id text PRIMARY KEY,
  -- The pause switch: off refuses every key of the organization without
  -- revoking any of them.
  enabled boolean NOT NULL DEFAULT false,
  -- The highest role the proxy may assert for a member it signs in; the door
  -- clamps the role header to it. `owner` is never assertable through a
  -- proxy, so it is not in the set.
  max_asserted_role text NOT NULL DEFAULT 'member'
    CHECK (max_asserted_role IN ('member', 'editor', 'developer', 'admin')),
  updated_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE TABLE app.trusted_header_keys (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- Admin-chosen label, so a rotation can say which proxy holds which key.
  name text NOT NULL,
  -- SHA-256 (hex) of the plaintext; the plaintext is answered exactly once
  -- and never stored.
  token_hash text NOT NULL,
  -- The marker plus the first characters of the plaintext, for display
  -- beside the name — safe to persist and show.
  token_prefix text NOT NULL,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  -- Sign-in stamp, throttled to at most once a minute per key.
  last_used_at_ms bigint,
  -- Revocation is a stamp, never a delete: the row stays the audit trail
  -- behind every session the key once minted, and a stamped row never
  -- matches a presented key.
  revoked_at_ms bigint,
  revoked_by text
);

-- The door's reverse lookup — one row per hash, ever.
CREATE UNIQUE INDEX trusted_header_keys_token_hash
  ON app.trusted_header_keys (token_hash);
-- The settings card's listing, newest first.
CREATE INDEX trusted_header_keys_org
  ON app.trusted_header_keys (org_id, created_at_ms DESC);
