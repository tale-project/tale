-- 0.5 app migration 0026: org agent secrets — named credentials injected
-- into an agent's sandbox turn as environment variables (the escape hatch
-- below the connector catalog). The row name IS the env var name, unique
-- per org; plaintext exists only inside the resolver (AES-256-GCM envelope
-- shared with provider credentials); listings carry the masked preview.

CREATE TABLE app.agent_secrets (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  description text,
  encrypted_value jsonb NOT NULL,
  masked_preview text,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_by text NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (org_id, name)
);

CREATE INDEX agent_secrets_org ON app.agent_secrets (org_id, name);
