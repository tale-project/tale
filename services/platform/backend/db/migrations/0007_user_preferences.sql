-- 0.5 app migration 0007: per-user, per-org personalization preferences.
--
-- Tri-state flags (NULL = follow the org's governance default, true/false =
-- explicit user override) — the 0.4 `undefined`/boolean contract mapped onto
-- nullable booleans. `chat_model_id` NULL = the composer's Auto.

CREATE TABLE app.user_preferences (
  user_id text NOT NULL,
  org_id text NOT NULL,
  custom_instructions text NOT NULL DEFAULT '',
  custom_instructions_enabled boolean,
  memories_enabled boolean,
  voice_output boolean,
  chat_model_id text,
  onboarding_completed boolean,
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX user_preferences_org ON app.user_preferences (org_id);
