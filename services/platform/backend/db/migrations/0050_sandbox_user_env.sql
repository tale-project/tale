-- 0.5 app migration 0050: user-level sandbox env/secrets (the 0.4
-- `sandboxUserEnv` table). One row per (org, user, key); secrets are
-- encrypted at rest (the shared secret_box envelope) and write-only —
-- the read API answers a fixed mask, never plaintext.
--
-- DEPRECATED (2026-09): the personal Environment page and its
-- `/api/app/sandbox/user-env` routes were retired — nothing ever injected
-- these rows into a sandbox, so the UI promised what no code did. The table
-- stays (applied schema is never dropped); no code reads or writes it.
CREATE TABLE app.sandbox_user_env (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  key text NOT NULL,
  is_secret boolean NOT NULL DEFAULT false,
  value text,
  encrypted jsonb,
  updated_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (org_id, user_id, key)
);

CREATE INDEX sandbox_user_env_org_user
  ON app.sandbox_user_env (org_id, user_id);
