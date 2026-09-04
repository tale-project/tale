-- SSO group→team sync provenance — what the sign-in sync is allowed to prune.
--
-- `syncTeamsFromGroupNames` (domains/sso/service.ts) mirrors a user's IdP
-- groups onto org teams at every SSO sign-in: create-if-missing by name, add
-- the membership, then reconcile away what the IdP no longer asserts. The
-- reconcile step used to remove the user from EVERY org team whose name was
-- absent from the claim and delete any team that emptied — including teams an
-- admin built under Settings > Teams and teams SCIM provisions (whose
-- app.sso_provisioning_links Group row was then left orphaned, so the IdP's
-- next group sync 404ed). A routine login silently dismantled structures the
-- org manages elsewhere.
--
-- These two tables record what the sync itself created, and the prune is
-- scoped to exactly that:
--   * sso_synced_teams — teams the sync created because no team of that name
--     existed. Only such a team is reaped when its last member leaves, and
--     never while a SCIM Group link claims it.
--   * sso_synced_team_members — memberships the sync inserted. Only these are
--     removed when their group leaves the claim; a membership an admin granted
--     (or SCIM composed) into a same-named team is left alone.
--
-- No foreign keys: Better Auth owns "team"/"teamMember" and migrates them
-- AFTER the app migrations run, so they may not exist yet on a fresh boot. A
-- row whose team or membership is gone (admin delete, SCIM replace, org
-- delete) is swept lazily by that user's next sync; org deletion removes the
-- rows in the same transaction as the teams.
--
-- Existing rows are deliberately NOT backfilled: a pre-existing team or
-- membership has unknown provenance, and unknown must read as "not mine" — the
-- sync adopts nothing and therefore never destroys what it cannot prove it
-- created. Memberships the sync granted before this migration are no longer
-- revoked automatically; an admin removes them once.

CREATE TABLE IF NOT EXISTS app.sso_synced_teams (
  org_id text NOT NULL,
  team_id text NOT NULL,
  created_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, team_id)
);

CREATE TABLE IF NOT EXISTS app.sso_synced_team_members (
  org_id text NOT NULL,
  team_id text NOT NULL,
  user_id text NOT NULL,
  created_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, team_id, user_id)
);

-- The per-login reconcile reads one user's synced memberships in one org.
CREATE INDEX IF NOT EXISTS sso_synced_team_members_org_user
  ON app.sso_synced_team_members (org_id, user_id);
