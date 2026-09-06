-- 0.5 app migration 0077: one row per (organization, RFC Message-ID) in
-- app.conversation_messages — the idempotency key the mailbox ingest dedupes
-- on (`checkMessageExists` → `getMessageByExternalId`).
--
-- Why: ingest was check-then-insert over a PLAIN index (0036
-- `conversation_messages_org_external`; 0064 notes the key "carries no UNIQUE
-- constraint"). Nothing serializes two sync passes of one mailbox — the
-- schedule claims the OCCURRENCE, not the run, and a manual run can overlap a
-- scheduled one — so a slow pass and the next tick both fetched the same
-- messages, both missed the lookup, and both inserted: the same mail twice in
-- the thread, and nothing ever reconciled it. The rule the lookup assumed
-- becomes the schema's: a partial unique index the database cannot forget,
-- and the shim's writers land the loser of a race on the winner's row
-- (`domains/conversations/shim.ts`).
--
-- Existing duplicates: the lowest `seq` (the first row to land) keeps the key.
-- Later duplicates are DETACHED from the key, never deleted — a message is the
-- org's record of its correspondence. The key they carried is kept in
-- `metadata.dedupedExternalMessageId`, so an operator can find the strays
-- and remove them deliberately.
--
-- Rolling-deploy safe: the previous image keeps working — its check-then-
-- insert only ever races itself, and the loser of that race now answers a
-- unique-violation for that one message (re-listed and deduped by the next
-- poll) instead of writing a second row.

WITH ranked AS (
  SELECT id, external_message_id,
         row_number() OVER (
           PARTITION BY org_id, external_message_id
           ORDER BY seq ASC
         ) AS rn
  FROM app.conversation_messages
  WHERE external_message_id IS NOT NULL
)
UPDATE app.conversation_messages m SET
  external_message_id = NULL,
  metadata = coalesce(m.metadata, '{}'::jsonb)
             || jsonb_build_object('dedupedExternalMessageId', ranked.external_message_id)
FROM ranked
WHERE m.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_org_external_unique
  ON app.conversation_messages (org_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

-- The plain index is a strict subset of the unique one for every lookup the
-- lanes issue (`org_id = $1 AND external_message_id = $2`).
DROP INDEX IF EXISTS app.conversation_messages_org_external;
