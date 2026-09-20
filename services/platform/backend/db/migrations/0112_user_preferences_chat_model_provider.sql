-- The sticky chat model pick remembers WHICH provider served it.
--
-- `chat_model_id` alone is ambiguous the moment two connectors list the same
-- model id — a shipped provider and an organization-defined one pointing at a
-- regional endpoint of the same vendor. Seeding a new chat by id alone picked
-- the first copy in connector order (the shipped one), whose credential the
-- user never meant, so the turn failed with that provider's refusal.
--
-- Nullable and unset for existing rows: a pick saved before this column
-- exists keeps resolving by id, exactly as before. The old code ignores the
-- column, so a rolling deploy is safe in both directions.
ALTER TABLE app.user_preferences
  ADD COLUMN IF NOT EXISTS chat_model_provider_slug text;

COMMENT ON COLUMN app.user_preferences.chat_model_provider_slug IS
  'The connector slug that served the sticky chat_model_id when it was picked; null = resolve by id alone (a pick saved before providers were part of it).';
