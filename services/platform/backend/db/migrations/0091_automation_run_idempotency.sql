-- The run-start idempotency ledger — what makes a retried `POST …/runs`
-- recognisable (the REST twin of 0069's webhook delivery ledger).
--
-- Starting a run answers 202 before the work happens, so a lost response is
-- the ordinary case a client retries — and every retry used to start
-- another run; the door silently discarded the very `Idempotency-Key` its
-- sibling webhook endpoint honours. One row per (organization, scope key):
-- the scope key is the SHA-256 of the URL project (or none), the automation
-- name and the caller's key, so a key is one caller's choice for one
-- automation in one scope. The door claims the row INSIDE the transaction
-- that starts the run (INSERT … ON CONFLICT DO UPDATE … WHERE expired,
-- RETURNING), so a concurrent repeat waits on the row lock and then reads
-- the run the first attempt started, and a refusal (a bad input, a version
-- not deployed, nothing deployed) rolls the claim back with the run it never
-- started — a 4xx is never remembered. The digests and the claim live in
-- backend/core/automations/run_idempotency.ts and the automations store.
--
--   request_hash    SHA-256 of the canonical request (`input`, `mode`,
--                   `version`): a repeat under the same key with a different
--                   request is refused (409 IDEMPOTENCY_KEY_REUSED) rather
--                   than answered with a run of something else.
--   run_id          the run the first attempt started; NULL only between the
--                   claim and the run insert inside one transaction, never in
--                   a committed row. Deleting the run forgets its keys.
--   expires_at_ms   the end of the key's window (a day, shared with the
--                   webhook door's explicit-id lane): a repeat after it is a
--                   new start. Expired rows are swept lazily, per
--                   organization, on each accepted start.
--
-- Rolling-deploy safe: a new table nothing in the previous image reads.

CREATE TABLE IF NOT EXISTS app.automation_run_idempotency (
  org_id text NOT NULL,
  -- Opaque and bounded: hex SHA-256 over project + automation name + key.
  scope_key text NOT NULL,
  request_hash text NOT NULL,
  run_id text,
  received_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, scope_key)
);

-- The lazy per-organization expiry sweep.
CREATE INDEX IF NOT EXISTS automation_run_idempotency_expiry
  ON app.automation_run_idempotency (org_id, expires_at_ms);
