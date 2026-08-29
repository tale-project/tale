-- Project-scoped secrets (0.4 `projectSecrets`): AES-256-GCM envelope via
-- `lib/secret_box` (the same primitive agent_secrets stores), value written
-- once and never read back through the API — listings carry metadata only,
-- plaintext resolution is reserved for runtime dispatch injection.
CREATE TABLE app.project_secrets (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  -- The env-var name (upper-cased, `SECRET_NAME_RE`), unique per project.
  name text NOT NULL,
  description text,
  -- The `encryptSecret` envelope ({ciphertext, nonce, authTag, keyFingerprint}).
  encrypted_value jsonb NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (org_id, project_id, name)
);

CREATE INDEX project_secrets_project
  ON app.project_secrets (org_id, project_id);
