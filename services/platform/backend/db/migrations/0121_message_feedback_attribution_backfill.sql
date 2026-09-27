-- Message feedback rows without attribution.
--
-- A thumbs vote stored whatever `agentSlug` / `model` / `provider` the client
-- sent — and the chat client never sent any — so every vote landed
-- unattributed: the feedback page's assistant table read 100 % "Unattributed"
-- and its model table was always empty. The vote door now derives the three
-- from the message itself (`app.messages.model`, `.provider_slug`, and the
-- thread's `agent_slug`); this backfill fills the rows voted before it did,
-- from the same sources, and leaves a value a row already has alone.
--
-- Arena verdict rows (`metadata IS NOT NULL`) name a synthetic message id and
-- carry their models in `metadata`; they are not touched.
--
-- Idempotent and bounded: a re-run finds no NULL it can fill. Rolling-deploy
-- safe: the previous image reads the columns exactly as before, values or
-- NULL.

UPDATE app.message_feedback f SET
  model = coalesce(f.model, m.model),
  provider = coalesce(f.provider, m.provider_slug),
  agent_slug = coalesce(f.agent_slug, tm.agent_slug)
FROM app.messages m
LEFT JOIN app.thread_metadata tm
  ON tm.thread_id = m.thread_id AND tm.org_id = m.org_id
WHERE m.id = f.message_id AND m.org_id = f.org_id
  AND f.metadata IS NULL
  AND (
    (f.model IS NULL AND m.model IS NOT NULL)
    OR (f.provider IS NULL AND m.provider_slug IS NOT NULL)
    OR (f.agent_slug IS NULL AND tm.agent_slug IS NOT NULL)
  );
