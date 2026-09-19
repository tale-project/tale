-- The billing subject of a managed agent turn: WHO a run's spend is booked
-- under in `app.usage_ledger` — always a bare user id (the person who started
-- the run), or the `__automation__` sentinel for a run a trigger started — and,
-- when an API key authenticated the start, WHICH key, so the key's own budget
-- caps see the spend the docs already promise them.
--
-- Before this file the workflow lane copied `automation_runs.started_by`
-- verbatim into the ledger's `user_id`. That column is the DOOR that started
-- the run (`user:<id>`, `api-key:<id>`, `trigger:<id>` — the format the REST
-- contract publishes on `startedBy`), not a person: the usage page showed
-- `api-key:…` rows, personal and team caps never saw automation spend, and a
-- keyed start booked nothing to its key because the run row never knew it.
-- The door format stays (the REST contract, erasure and the trigger fire
-- ledger all read it); the person is derived from it at booking time, and the
-- key gets a column of its own here. Historical ledger rows are NOT rewritten
-- (decision 2026-09-19: new data has to be clean, history stays as booked).
--
-- Rolling-deploy safe: both columns are nullable additions the previous image
-- never reads or writes. Idempotent: `IF NOT EXISTS` throughout.

-- ── automation_runs: the API key that authenticated a keyed start ─────────
-- NULL for a start from the product, the builder, the chat capability or a
-- trigger; set by the REST and MCP doors (`api-key:<userId>` starters). The
-- settlement copies it into the ledger's `api_key_id` beside the starter's
-- bare user id.
ALTER TABLE app.automation_runs
  ADD COLUMN IF NOT EXISTS api_key_id text;

-- ── sandbox_session_ops: the reservation's stamp of the same subject ──────
-- The op row already carries `user_id` and `agent_slug` as the settlement's
-- fallback for an op whose run row is gone; the key joins them so the
-- fallback books the same subject the reservation was measured against.
ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS api_key_id text;
