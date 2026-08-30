-- External (non-Better-Auth) author identities.
--
-- A Slack user who writes into a connected workspace is an author with no
-- account here. The owner id is namespaced AND org-scoped
-- (`slack:<org>:<external user>`), because the same Slack user id can appear
-- in workspaces belonging to different organizations and those are different
-- people as far as tenancy is concerned — so the id is the primary key and a
-- row can never span tenants.
CREATE TABLE app.external_identities (
  owner_id text PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('slack')),
  org_id text NOT NULL,
  external_user_id text NOT NULL,
  display_name text,
  handle text,
  avatar_url text,
  created_at_ms bigint NOT NULL,
  -- Freshness of the LAST successful profile fetch. A failed refresh must
  -- leave this alone, or the next message would be suppressed for the whole
  -- refresh window instead of retrying (the 0.4 rule).
  updated_at_ms bigint NOT NULL
);

CREATE INDEX external_identities_org
  ON app.external_identities (org_id, source);
