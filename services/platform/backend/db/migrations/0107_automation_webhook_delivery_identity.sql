-- A webhook delivery's SCOPE-FREE identity, so the cross-scope duplicate guard
-- the docs promise (`409 AUTOMATION_DELIVERY_SCOPE_MISMATCH`) can actually fire.
--
-- `delivery_key` folds the requested project into its hash, so the same
-- delivery id at the organization door and at a project door produced two
-- different keys, two ledger rows and two runs: an operator who moved an
-- automation between organization and project scope had the sender's
-- redelivery run a second time, silently, and the documented 409 never fired
-- (2026-09-18 evaluation, J3-1 / round I's S3). Per-project fan-out stays
-- legitimate — the same id may start one run in each installed project — so
-- the mismatch is only the organization-vs-project transition.
--
-- `identity_hash` is the SHA-256 over the delivery's lane and material WITHOUT
-- the project (`webhook_delivery.ts`), so every scope's row for one delivery
-- shares it. The accept path reads the live rows that share it and, when one
-- belongs to the organization door and the other to a project door (or the
-- reverse), answers the 409 instead of starting a run.
--
-- Rolling-deploy safe: the column is nullable, the previous image neither
-- writes nor reads it (its rows simply do not participate in the new guard),
-- and no backfill is possible or needed — the guard governs deliveries from
-- here on, within the 24-hour identity window.

ALTER TABLE app.automation_webhook_deliveries
  ADD COLUMN IF NOT EXISTS identity_hash text;

-- The guard's lookup: live rows for one trigger sharing a scope-free identity.
CREATE INDEX IF NOT EXISTS automation_webhook_deliveries_identity
  ON app.automation_webhook_deliveries (trigger_id, identity_hash, expires_at_ms);
