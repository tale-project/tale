-- A live chat turn holds what it may spend against the budget caps, and an
-- organization's budget admissions queue behind one row.
--
-- Chat turns were admitted against the BOOKED usage alone, and a turn books
-- its usage only once it settles: N sends racing a cap with room for one all
-- passed, and the cap was overshot N-fold (2026-09-15).
--
-- `app.generations` (one row per live turn, deleted when the turn settles,
-- when the watchdog clears a dead one, or with its thread) now carries the
-- turn's hold: the member it spends for (`user_id`), the API key that
-- authenticated it (`api_key_id`), and its first round's worst case
-- (`reserved_cost_cents`, `reserved_tokens`: the prompt as assembled plus the
-- output reserve, at the model's catalog rates). The budget gate adds every
-- other live row's hold — and every unsettled managed-turn allowance on
-- `app.sandbox_session_ops` — to the booked usage, so a hold ends exactly
-- when its row does, on every path. `user_id` NULL is a row without a hold.
--
-- `app.budget_admissions`: the row every budget admission of the organization
-- locks and bumps before it reads the holds (a chat turn's open, a managed
-- turn's allowance). Under READ COMMITTED its lock queues the admissions and
-- the next one reads the hold the previous one wrote. A SERIALIZABLE open (the
-- REST lane) fixes its snapshot at its first statement, so an admission
-- committed in between would be invisible to it — the bump turns that into a
-- 40001 at the lock, retried on the org's queue key (`transactSerializable`),
-- instead of a decision made on a stale view.
--
-- Rolling-deploy safe: the new columns are nullable or defaulted, so the
-- previous image's claims hold nothing, and it never reads the new table.

ALTER TABLE app.generations
  ADD COLUMN IF NOT EXISTS user_id text,
  ADD COLUMN IF NOT EXISTS api_key_id text,
  ADD COLUMN IF NOT EXISTS reserved_cost_cents double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_tokens bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS app.budget_admissions (
  org_id text PRIMARY KEY,
  -- When the organization's last budget admission took the row: the bump
  -- is what a stale SERIALIZABLE snapshot conflicts with.
  admitted_at_ms bigint NOT NULL
);
