-- Keep prospective passkey authority bound while preserving inventoried legacy factors
--
-- Better Auth still owns passkey rows. This holds only their authority:
-- new organization ceremonies cannot become global factors, and a one-time
-- operator-fenced inventory preserves historical passkey compatibility
-- without asserting historical minting provenance. Pending stages are written
-- AFTER genuine verification but BEFORE Better Auth generates the row id;
-- a failed registration cannot be grandfathered by the later inventory.
--
-- Rolling-deploy safe: the previous image is still serving while this applies.

-- No FK to Better Auth tables: app migrations run BEFORE those tables exist
-- on fresh boot. Readers join/revalidate the live credential's row and user.
CREATE TABLE app.auth_factor_authorities (
  -- SHA-256 of the public WebAuthn credential handle, solely a staging join.
  -- No public/private key, counter, secret or credential crypto is copied.
  credential_fingerprint text PRIMARY KEY
    CHECK (credential_fingerprint ~ '^[0-9a-f]{64}$'),
  credential_id text UNIQUE,
  user_id text NOT NULL CHECK (user_id <> ''),
  org_id text,
  -- A proxy-limited organization session may enroll a factor. Preserve the
  -- asserted ceiling so a later logged-out ceremony cannot fall back to a
  -- newly promoted membership. NULL means no proxy ceiling was present.
  trusted_role text,
  authority text NOT NULL CHECK (authority IN ('global', 'organization', 'legacy_compatible')),
  state text NOT NULL CHECK (state IN ('pending', 'bound')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((authority = 'organization' AND org_id IS NOT NULL AND org_id <> '')
    OR (authority <> 'organization' AND org_id IS NULL)),
  CHECK (trusted_role IS NULL OR trusted_role IN ('member', 'editor', 'developer', 'admin')),
  CHECK (authority = 'organization' OR trusted_role IS NULL),
  CHECK ((state = 'pending' AND credential_id IS NULL AND authority <> 'legacy_compatible')
    OR (state = 'bound' AND credential_id IS NOT NULL AND credential_id <> ''))
);
CREATE INDEX auth_factor_authorities_user ON app.auth_factor_authorities (user_id, authority);
CREATE INDEX auth_factor_authorities_org_user ON app.auth_factor_authorities (org_id, user_id)
  WHERE org_id IS NOT NULL;

-- The same atomic cutover inventory records exact legacy browser rows that
-- cannot establish a global realm. Provider unlink or a later proof must
-- not revive that old cookie; a genuine new login creates another session.
-- This is refusal metadata, not a rewritten session or a claim of origin.
CREATE TABLE app.auth_legacy_session_refusals (
  session_id text NOT NULL CHECK (session_id <> ''),
  user_id text NOT NULL CHECK (user_id <> ''),
  cutover_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX auth_legacy_session_refusals_user ON app.auth_legacy_session_refusals (user_id);
