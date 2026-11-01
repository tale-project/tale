-- A key's spend in a period, through an index of its own.
--
-- The budget gate sums a key's caps over the ledger rows the key booked and
-- the rows its own identity booked (`periodUsage` in
-- `backend/domains/governance/budget-gate.ts`):
-- `org_id = $1 AND period_key = $2 AND (api_key_id = $3 OR user_id = ANY($4))`.
-- No index held `api_key_id`, so the planner could not answer the OR with two
-- index scans, and every admission of a key read the organization's whole
-- period (`usage_ledger_org_period`) to filter it. With this index the OR is a
-- BitmapOr of it and the bucket index (`org_id, user_id, period_key, …`),
-- which already serves the identity's forms, a person's sum and a team's.
--
-- Partial: only a row a key booked carries an `api_key_id`, and the gate's
-- `api_key_id = $3` proves the predicate in custom and generic plans alike.
--
-- No INCLUDE of the summed columns: every booking's upsert updates them, so
-- holding them here would turn each booking into an update that writes a new
-- entry into every ledger index (no HOT update). The gate reads the current
-- period, the rows bookings keep updating, whose pages are rarely all-visible,
-- so an index-only scan would visit the heap all the same.
--
-- Indexes are not inherited (0204): a read of `app.usage_ledger` scans the
-- parent and `app.usage_ledger_provider`, so each carries its own copy.
--
-- Plain CREATE INDEX: a migration runs in one transaction, so CONCURRENTLY is
-- unavailable; ledger writes wait for one pass over each table while it
-- builds, and reads go on. Rolling-deploy safe: an index only, which the
-- previous image's reads may use as well.

CREATE INDEX IF NOT EXISTS usage_ledger_api_key_period
  ON app.usage_ledger (org_id, api_key_id, period_key)
  WHERE api_key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_ledger_provider_api_key_period
  ON app.usage_ledger_provider (org_id, api_key_id, period_key)
  WHERE api_key_id IS NOT NULL;
