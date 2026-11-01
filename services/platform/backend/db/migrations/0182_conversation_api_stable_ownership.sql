-- 0.5 app migration 0182: preserve API conversation source ownership when
-- an organization, team, project or delegated-member key is rotated.
--
-- `owner_user_id` is the identity minted for one API key. It remains useful
-- for attribution and for older images, but it is not a stable integration
-- identity. The principal columns carry the identity the key represents;
-- personal keys use their user id, while owned keys use their durable scope.
-- Existing bindings are backfilled from retained API-key owner rows. A
-- binding whose key was personal has no owner row and keeps its user id.

ALTER TABLE app.conversation_api_bindings
  ADD COLUMN IF NOT EXISTS owner_principal_kind text,
  ADD COLUMN IF NOT EXISTS owner_principal_id text;

UPDATE app.conversation_api_bindings b
SET owner_principal_kind = CASE o.owner_kind
    WHEN 'member' THEN 'member'
    WHEN 'team' THEN 'team'
    WHEN 'project' THEN 'project'
    WHEN 'organization' THEN 'organization'
    ELSE 'user'
  END,
  owner_principal_id = CASE o.owner_kind
    WHEN 'member' THEN o.principal_user_id
    WHEN 'team' THEN o.team_id
    WHEN 'project' THEN o.project_id
    WHEN 'organization' THEN o.org_id
    ELSE b.owner_user_id
  END
FROM app.api_key_owners o
WHERE o.key_user_id = b.owner_user_id;

UPDATE app.conversation_api_bindings
SET owner_principal_kind = 'user', owner_principal_id = owner_user_id
WHERE owner_principal_kind IS NULL OR owner_principal_id IS NULL;

-- An older image may still insert a binding during a rolling deploy. Fill the
-- principal before constraints run so that image can keep writing while this
-- migration is live.
CREATE OR REPLACE FUNCTION app.conversation_api_binding_owner_principal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_principal_kind IS NULL OR NEW.owner_principal_id IS NULL THEN
    SELECT CASE o.owner_kind
             WHEN 'member' THEN 'member'
             WHEN 'team' THEN 'team'
             WHEN 'project' THEN 'project'
             WHEN 'organization' THEN 'organization'
             ELSE 'user'
           END,
           CASE o.owner_kind
             WHEN 'member' THEN o.principal_user_id
             WHEN 'team' THEN o.team_id
             WHEN 'project' THEN o.project_id
             WHEN 'organization' THEN o.org_id
             ELSE NEW.owner_user_id
           END
      INTO NEW.owner_principal_kind, NEW.owner_principal_id
      FROM app.api_key_owners o
     WHERE o.key_user_id = NEW.owner_user_id
     LIMIT 1;
    NEW.owner_principal_kind := coalesce(NEW.owner_principal_kind, 'user');
    NEW.owner_principal_id := coalesce(NEW.owner_principal_id, NEW.owner_user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_api_binding_owner_principal
  ON app.conversation_api_bindings;
CREATE TRIGGER conversation_api_binding_owner_principal
  BEFORE INSERT ON app.conversation_api_bindings
  FOR EACH ROW EXECUTE FUNCTION app.conversation_api_binding_owner_principal();

ALTER TABLE app.conversation_api_bindings
  ALTER COLUMN owner_principal_kind SET NOT NULL,
  ALTER COLUMN owner_principal_id SET NOT NULL;

ALTER TABLE app.conversation_api_bindings
  DROP CONSTRAINT IF EXISTS conversation_api_bindings_owner_principal_kind,
  ADD CONSTRAINT conversation_api_bindings_owner_principal_kind
    CHECK (owner_principal_kind IN ('user', 'member', 'team', 'project', 'organization'));

CREATE INDEX IF NOT EXISTS conversation_api_bindings_principal
  ON app.conversation_api_bindings(
    org_id,
    source,
    owner_principal_kind,
    owner_principal_id
  );
