-- 0.5 app migration 0034: inbound SCIM state — the 0.4 `ssoConnections` +
-- `ssoProvisioningLinks` tables. The org's sign-in/provisioning CONFIG lives
-- in per-org files (governance/sso/connection.yml); these rows hold only
-- what files cannot serve:
--   * the SCIM bearer token (SHA-256 hash — resolving an inbound request to
--     its org is a reverse lookup by hash, which needs an index), and
--   * per-resource provisioning links (the IdP's externalId round-trip and
--     a deactivated user's prior role for restore).

CREATE TABLE app.sso_connections (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  scim_enabled boolean NOT NULL DEFAULT false,
  scim_token_hash text NOT NULL DEFAULT '',
  scim_token_prefix text NOT NULL DEFAULT '',
  scim_token_generated_at_ms bigint,
  scim_last_used_at_ms bigint,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE UNIQUE INDEX sso_connections_org ON app.sso_connections (org_id);
-- A disabled connection stores an empty hash; empty never matches a real
-- token (the lookup refuses empty input), so no partial index is needed.
CREATE INDEX sso_connections_token_hash
  ON app.sso_connections (scim_token_hash);

CREATE TABLE app.sso_provisioning_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('User', 'Group')),
  internal_id text NOT NULL,
  external_id text,
  last_active_role text,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE UNIQUE INDEX sso_provisioning_links_org_internal
  ON app.sso_provisioning_links (org_id, internal_id);
CREATE INDEX sso_provisioning_links_org_external
  ON app.sso_provisioning_links (org_id, external_id);
CREATE INDEX sso_provisioning_links_org_type
  ON app.sso_provisioning_links (org_id, resource_type);
