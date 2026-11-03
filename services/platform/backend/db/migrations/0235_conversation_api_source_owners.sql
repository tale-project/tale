-- Who owns an API-mirrored conversation: the integration, not the key.
--
-- A mirror (`app.conversation_api_bindings`) recorded the identity of the key
-- that first sent it (`owner_user_id`), and every later call by another
-- identity was refused. That held for a person's own key, which always acts
-- as the same user. A key made for a team or the organization authenticates
-- as an identity of its own (`app.api_key_owners.key_user_id`), so replacing
-- it with a new key stranded every mirror and every reply already queued for
-- them: `INTEGRATION_NOT_OWNED`, with no way to hand them over.
--
--   owner_principal_kind, owner_principal_id
--       whom the mirror belongs to. `user` is a person: a personal key and a
--       key an Owner or Admin made for a member both act as them. `team` and
--       `organization` are what a service key was made for, so any key of
--       that team or organization continues its mirrors. A project's key
--       never reaches these routes (the door keeps it inside its project).
--
--   owner_user_id
--       stays the identity of the key that first sent the mirror, for the
--       audit trail and for the previous image.
--
-- Backfill: a binding a key made for a team or the organization wrote takes
-- that owner from `api_key_owners` (the row survives a revocation).
-- Every other binding belongs to its user, as it always did — a key made for
-- a member acts AS the member, so the binding already carries the member's
-- id, never the id of the key.
--
-- Rolling deploy: the previous image keeps inserting bindings without the
-- principal while it serves. The trigger below fills it the way the backfill
-- does, so a mirror it creates is owned like any other, and the new image
-- reads only the principal. The previous image still compares
-- `owner_user_id`, so until the roll ends it refuses a replacement key, as it
-- did before this migration; the trigger and the `owner_user_id` index go once
-- no image that predates it is deployed.

ALTER TABLE app.conversation_api_bindings
  ADD COLUMN IF NOT EXISTS owner_principal_kind text,
  ADD COLUMN IF NOT EXISTS owner_principal_id text;

UPDATE app.conversation_api_bindings b
SET owner_principal_kind = o.owner_kind,
    owner_principal_id = CASE o.owner_kind
      WHEN 'team' THEN o.team_id
      ELSE o.org_id
    END
FROM app.api_key_owners o
WHERE o.key_user_id = b.owner_user_id
  AND o.org_id = b.org_id
  AND o.owner_kind IN ('team', 'organization')
  AND b.owner_principal_kind IS NULL;

UPDATE app.conversation_api_bindings
SET owner_principal_kind = 'user', owner_principal_id = owner_user_id
WHERE owner_principal_kind IS NULL;

CREATE OR REPLACE FUNCTION app.conversation_api_binding_owner_principal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_principal_kind IS NULL OR NEW.owner_principal_id IS NULL THEN
    SELECT o.owner_kind,
           CASE o.owner_kind
             WHEN 'team' THEN o.team_id
             ELSE o.org_id
           END
      INTO NEW.owner_principal_kind, NEW.owner_principal_id
      FROM app.api_key_owners o
     WHERE o.key_user_id = NEW.owner_user_id
       AND o.org_id = NEW.org_id
       AND o.owner_kind IN ('team', 'organization');
    IF NEW.owner_principal_kind IS NULL OR NEW.owner_principal_id IS NULL THEN
      NEW.owner_principal_kind := 'user';
      NEW.owner_principal_id := NEW.owner_user_id;
    END IF;
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
    CHECK (owner_principal_kind IN ('user', 'team', 'organization'));

-- Every read the new image makes names the principal: the source's mirrors,
-- its queue and a claim all start from `(org_id, source)`.
CREATE INDEX IF NOT EXISTS conversation_api_bindings_principal
  ON app.conversation_api_bindings (
    org_id,
    source,
    owner_principal_kind,
    owner_principal_id
  );
