-- The webhook delivery ledger — what makes a redelivery recognisable.
--
-- Vendors deliver at-least-once: a slow response, a dropped connection, or an
-- operator's "redeliver" button sends the same delivery again, and the
-- webhook door used to start a fresh live run per POST. One row per
-- (trigger, delivery identity): the identity is the sender's delivery id when
-- it sends one (`Idempotency-Key`, `webhook-id`, `X-GitHub-Delivery`, …) and
-- the SHA-256 of the raw body otherwise — the lanes and their windows live in
-- backend/core/automations/webhook_delivery.ts. The door claims the identity
-- INSIDE the transaction that starts the run (INSERT … ON CONFLICT DO UPDATE
-- … WHERE expired, RETURNING), so a concurrent repeat waits on the row lock
-- and then reads the run the first delivery started: a repeat answers with
-- that run instead of starting a second one.
--
-- run_id is NULL only between the claim and the run insert inside one
-- transaction — never in a committed row (a start that finds no deployed
-- version rolls the claim back with it). expires_at_ms is the end of the
-- identity's window: an identical delivery after it is a new delivery (a
-- heartbeat posting the same body every few minutes keeps working), and the
-- door deletes a trigger's expired rows lazily on each accepted delivery.
-- Deleting the trigger takes its ledger with it.

CREATE TABLE IF NOT EXISTS app.automation_webhook_deliveries (
  trigger_id text NOT NULL
    REFERENCES app.automation_triggers (id) ON DELETE CASCADE,
  -- Opaque and bounded: hex SHA-256 over lane + delivery material + project.
  delivery_key text NOT NULL,
  -- Which lane produced the key: `header:<header-name>` or `body`.
  source text NOT NULL,
  run_id text,
  received_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  PRIMARY KEY (trigger_id, delivery_key)
);

-- The lazy per-trigger expiry sweep.
CREATE INDEX IF NOT EXISTS automation_webhook_deliveries_expiry
  ON app.automation_webhook_deliveries (trigger_id, expires_at_ms);
