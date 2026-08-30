-- Arena Mode + pending questions.
--
-- The pair marker lives on the thread sidecar exactly like the 0.4
-- `threads.arena` object: `{pairId, role, partnerThreadId, createdAt}`
-- while the pair is live, NULL once settled.
ALTER TABLE app.thread_metadata ADD COLUMN arena jsonb;

-- An arena verdict INSERTS a fresh feedback row per settle on a synthetic
-- `arena:modelA:modelB` message id (two runs of one matchup are two data
-- points — the 0.4 contract in `lib/shared/arena.ts`). The blanket
-- (message_id, user_id) uniqueness was the per-message VOTE upsert's; it
-- narrows to real votes (metadata IS NULL — arena rows always carry the
-- verdict metadata) so verdicts stack while votes keep upserting.
ALTER TABLE app.message_feedback
  DROP CONSTRAINT message_feedback_message_id_user_id_key;
CREATE UNIQUE INDEX message_feedback_vote_unique
  ON app.message_feedback (message_id, user_id)
  WHERE metadata IS NULL;
