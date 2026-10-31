-- A competence grant may name a team, and the memberships it reaches.
--
-- An admin grants a platform capability (`tale:` slug) to a team instead of
-- one member at a time: the team's members hold it while they are in the
-- team, including members who join after the grant, and leaving the team
-- ends it (`backend/domains/governance/competence.ts`, `holdsCapability`
-- and `vouchesForUser`). Only a membership an owner or admin made carries
-- the grant: a membership SCIM or SSO group sync made would let the
-- identity provider confer the right, which no admin chose.
--
-- `app.competence_records` holds a team grant as a row with `team_id` set
-- and `user_id` NULL; the CHECK keeps exactly one holder per row, and the
-- second partial unique index keeps one live grant per team and competence,
-- as the first does per member (a NULL `user_id` never collides there).
--
-- `app.admin_added_team_members` is the positive record of the memberships
-- an admin made: the admin door (`POST /api/app/teams/:teamId/members`)
-- writes it in the transaction that inserts the "teamMember" row, keyed by
-- that row's id. A membership any other door makes carries no record, so it
-- confers nothing; a membership SCIM or SSO removes and adds back is a new
-- row with a new id and never inherits the record. No foreign keys: Better
-- Auth owns "teamMember" and creates it after the app migrations on a fresh
-- database. Every door that deletes a membership deletes its record too;
-- one left behind matches no membership and confers nothing.
--
-- Backfill: every existing membership is recorded, except those the
-- sign-in sync records as its own (`app.sso_synced_team_members`) and every
-- membership of a team SSO created (`app.sso_synced_teams`) or SCIM links
-- as a Group (`app.sso_provisioning_links`). Two kinds cannot be told apart
-- and are recorded: a membership SCIM wrote into a team it does not link,
-- and one the sign-in sync made before 0071 recorded its provenance.
-- Guarded like 0120: on a fresh database "teamMember" does not exist yet
-- and there is nothing to record.
--
-- Rolling-deploy safe: every existing row satisfies the CHECK; the previous
-- image always writes `user_id`, reads grants by `user_id` (so a team row
-- vouches for nobody there) and lists a team row as a former member's until
-- the roll completes. A membership the previous image adds during the roll
-- carries no record and confers nothing until an admin adds it again.

ALTER TABLE app.competence_records ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE app.competence_records ADD COLUMN IF NOT EXISTS team_id text;

ALTER TABLE app.competence_records
  DROP CONSTRAINT IF EXISTS competence_records_one_holder;

ALTER TABLE app.competence_records
  ADD CONSTRAINT competence_records_one_holder
  CHECK ((user_id IS NULL) <> (team_id IS NULL));

-- At most ONE live grant of a competence per team, as per member.
CREATE UNIQUE INDEX IF NOT EXISTS competence_records_active_team_grant
  ON app.competence_records (org_id, team_id, competence)
  WHERE revoked_at_ms IS NULL AND team_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.admin_added_team_members (
  -- The "teamMember" row the admin door inserted.
  team_member_id text PRIMARY KEY,
  org_id text NOT NULL,
  team_id text NOT NULL,
  created_at_ms bigint NOT NULL
);

-- Team deletion drops a team's records in one statement.
CREATE INDEX IF NOT EXISTS admin_added_team_members_org_team
  ON app.admin_added_team_members (org_id, team_id);

DO $$
BEGIN
  IF to_regclass('"teamMember"') IS NOT NULL
    AND to_regclass('"team"') IS NOT NULL THEN
    INSERT INTO app.admin_added_team_members (
      team_member_id, org_id, team_id, created_at_ms
    )
    SELECT tm."id", t."organizationId", tm."teamId",
           (extract(epoch FROM now()) * 1000)::bigint
    FROM "teamMember" tm
    JOIN "team" t ON t."id" = tm."teamId"
    WHERE NOT EXISTS (
        SELECT 1 FROM app.sso_synced_team_members s
        WHERE s.org_id = t."organizationId" AND s.team_id = tm."teamId"
          AND s.user_id = tm."userId"
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.sso_synced_teams s
        WHERE s.org_id = t."organizationId" AND s.team_id = tm."teamId"
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.sso_provisioning_links l
        WHERE l.org_id = t."organizationId" AND l.internal_id = tm."teamId"
          AND l.resource_type = 'Group'
      )
    ON CONFLICT (team_member_id) DO NOTHING;
  END IF;
END $$;
