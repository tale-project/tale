-- The chat-send idempotency ledger — what makes a retried
-- `POST …/threads/{id}/messages` recognisable (the REST chat twin of
-- 0091's run-start ledger).
--
-- A send answers 202 before the turn runs, so a lost response is the
-- ordinary case a client retries — and every retry used to start, and
-- bill, another turn; the door read no `Idempotency-Key` at all. One row
-- per (organization, scope key): the scope key is the SHA-256 of the URL
-- project (or none), the thread id and the caller's key, so a key is one
-- caller's choice for one thread in one scope. The door claims the row
-- INSIDE the transaction that sets the thread's queued marker and enqueues
-- the turn (INSERT … ON CONFLICT DO UPDATE … WHERE expired, RETURNING), so
-- a concurrent repeat waits on the row lock and then reads the send the
-- first attempt accepted, and a refusal (a thread already mid-turn) rolls
-- the claim back with the marker it never set — a 4xx is never remembered.
-- The digests and the claim live in backend/domains/chat/send-idempotency.ts.
--
--   request_hash    SHA-256 of the canonical body (`content`, `model`,
--                   `providerSlug`, `reasoningEffort`, `maxOutputTokens`,
--                   `locale`): a repeat under the same key with a different
--                   body is refused (409 IDEMPOTENCY_KEY_REUSED) rather than
--                   answered with a turn of something else.
--   thread_id       the thread the send was accepted on — the scope, kept
--                   readable for an operator; a deleted thread answers 404 at
--                   the door before any replay, so no row outlives its use.
--   message_id      the assistant message the first attempt's 202 named;
--                   NULL only between the claim and the accept inside one
--                   transaction, never in a committed row.
--   response        the 202 body the first attempt answered, replayed
--                   verbatim (plus `duplicate: true`) on a repeat.
--   expires_at_ms   the end of the key's window (a day, the run ledger's
--                   window): a repeat after it is a new send. Expired rows
--                   are swept lazily, per organization, on each accepted
--                   send.
--
-- Rolling-deploy safe: a new table nothing in the previous image reads.

CREATE TABLE IF NOT EXISTS app.chat_send_idempotency (
  org_id text NOT NULL,
  -- Opaque and bounded: hex SHA-256 over project + thread + key.
  scope_key text NOT NULL,
  request_hash text NOT NULL,
  thread_id text NOT NULL,
  message_id text,
  response jsonb,
  received_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, scope_key)
);

-- The lazy per-organization expiry sweep.
CREATE INDEX IF NOT EXISTS chat_send_idempotency_expiry
  ON app.chat_send_idempotency (org_id, expires_at_ms);
