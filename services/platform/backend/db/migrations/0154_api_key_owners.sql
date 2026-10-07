-- Who an API key belongs to when it is not the person who made it.
--
-- A key the api-key plugin mints belongs to a user (`apikey.referenceId`)
-- and acts as that person in every organization they are a member of. Two
-- more kinds of key exist, each bound to ONE organization:
--
--  - `member`: a key an Owner or Admin made for another member. It acts as
--    that member, with their live role and teams, in this organization only.
--  - `team`, `project`, `organization`: a key that is not a person. It acts
--    as an identity of its own — a `"user"` row with no `member` or
--    `teamMember` row, so no member list, picker, notification fan-out or
--    identity-provider sync ever sees it — with the role chosen when it was
--    made: across the organization, with one team's audience, or inside one
--    project and nowhere else. It keeps working when its maker leaves.
--
-- A key with no row here is a person's own key and behaves as it always did.
-- The REST door reads the row on every keyed request (`backend/rest/v1.ts`);
-- the budget gate reads it to measure a key that is not a person against no
-- personal cap, and a team's key against the team's shared caps
-- (`domains/governance/budget-gate.ts`).
--
-- A revoked key's row is RETAINED: the `apikey` row is deleted, but whose key
-- it was stays the trail behind the spend and the audit rows that name it,
-- so revocation is a stamp, never a delete. Only deleting the organization
-- deletes its rows, with every other row the organization keyed.
-- `api_key_id` carries no foreign key: Better Auth creates `"apikey"` after
-- the numbered migrations run, and deletes an expired key on its own.
--
-- Rolling-deploy safe: a new table the previous image never reads. Keys the
-- previous image mints during the roll are personal keys, as they were; a
-- key this image makes for a member is, on the previous image, that member's
-- own key until the roll completes, and a key that is not a person is no
-- member there, so the previous image refuses it.

CREATE TABLE IF NOT EXISTS app.api_key_owners (
  -- The Better Auth `apikey.id`.
  api_key_id text PRIMARY KEY,
  -- The one organization the key works in.
  org_id text NOT NULL,
  owner_kind text NOT NULL
    CHECK (owner_kind IN ('member', 'team', 'project', 'organization')),
  -- Who the key acts as (`apikey.referenceId`): the member, or the key's own
  -- identity for a team, project or organization key.
  principal_user_id text NOT NULL,
  team_id text,
  project_id text,
  -- The role a team, project or organization key acts with. A member's key
  -- acts with the member's live role, so it carries none.
  role text CHECK (role IN ('member', 'editor', 'developer', 'admin')),
  -- The name the key was made with, kept for the trail once its row is gone.
  name text NOT NULL,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  -- Revocation stamp; the row survives it.
  revoked_at_ms bigint,
  revoked_by text,
  CONSTRAINT api_key_owners_team_target
    CHECK ((owner_kind = 'team') = (team_id IS NOT NULL)),
  CONSTRAINT api_key_owners_project_target
    CHECK ((owner_kind = 'project') = (project_id IS NOT NULL)),
  CONSTRAINT api_key_owners_role_set
    CHECK ((owner_kind = 'member') = (role IS NULL)),
  -- A team's or a project's key sees what a member of a team sees; an admin
  -- role would see every audience in the organization.
  CONSTRAINT api_key_owners_scoped_role
    CHECK (owner_kind NOT IN ('team', 'project') OR role <> 'admin')
);

-- A key that is not a person is its own identity: one identity, one key.
CREATE UNIQUE INDEX IF NOT EXISTS api_key_owners_service_principal
  ON app.api_key_owners (principal_user_id)
  WHERE owner_kind <> 'member';

CREATE INDEX IF NOT EXISTS api_key_owners_org
  ON app.api_key_owners (org_id, owner_kind);

-- The keys made for one member, which their removal from the organization
-- revokes.
CREATE INDEX IF NOT EXISTS api_key_owners_member
  ON app.api_key_owners (org_id, principal_user_id)
  WHERE owner_kind = 'member';

CREATE INDEX IF NOT EXISTS api_key_owners_team
  ON app.api_key_owners (team_id)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS api_key_owners_project
  ON app.api_key_owners (project_id)
  WHERE project_id IS NOT NULL;
