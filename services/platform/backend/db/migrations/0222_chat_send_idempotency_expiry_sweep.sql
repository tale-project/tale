-- The expired chat send keys are swept by a cron, across organizations.
--
-- 0094's ledger swept an organization's expired keys inside every keyed send
-- (`rememberAcceptedSend`): concurrent sends of one organization locked and
-- deleted the same expired rows, each waiting on the one before it, and the
-- keys of an organization that stopped sending stayed for good. The hourly
-- `chat.send_idempotency_gc` job sweeps them instead
-- (`sweepExpiredSendKeys` in `backend/domains/chat/send-idempotency.ts`):
-- every organization's expired keys, oldest first, a bounded batch per
-- statement. A send still takes over an expired key by itself (the claim's
-- `WHERE expired`), so when the sweep runs changes no answer.
--
-- The sweep reads `expires_at_ms <= now` across organizations, which the
-- per-organization index (`org_id, expires_at_ms`) cannot serve on Postgres 16
-- (no skip scan), so that index, which nothing else reads, gives way to one
-- on `expires_at_ms`.
--
-- Rolling-deploy safe: the previous image keeps sweeping per organization on
-- each keyed send while the roll lasts; without its index, that DELETE finds
-- the organization's keys through the primary key (`org_id, scope_key`) and
-- deletes the same rows.

CREATE INDEX IF NOT EXISTS chat_send_idempotency_expires_at
  ON app.chat_send_idempotency (expires_at_ms);

DROP INDEX IF EXISTS app.chat_send_idempotency_expiry;
