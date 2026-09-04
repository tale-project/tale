-- The sandbox watchdog's fair-scan stamp: when a session row was last checked
-- against the spawner.
--
-- The 5-minute drift sweep (domains/sandbox/watchdogs.ts) probes a bounded
-- batch of compute-holding rows against the spawner — a container gone
-- spawner-side settles its row as destroyed (the phantom heal) — and, since
-- the same change, reclaims the per-run sessions of ended automation runs.
-- The reconcile batch used to be the 25 GLOBALLY-OLDEST rows by created_at_ms
-- with no rotation: long-lived healthy sessions (a pinned always-on agent
-- never expires) sat at the head forever, so a younger phantom `active` row
-- behind them was never probed and held one of the org's few slots until its
-- 24h TTL — indefinitely when pinned. Every spawner-facing pass now orders its
-- batch by this stamp (NULL = never visited, first) and stamps the rows it
-- visited, so the walk is a round-robin over the whole table: every row is
-- reached within ceil(rows / batch) ticks whatever sits at the head.
--
-- Nullable, no backfill: an unstamped row simply sorts first. Rolling-deploy
-- safe — the previous image never reads or writes the column.

ALTER TABLE app.sandbox_sessions
  ADD COLUMN IF NOT EXISTS last_reconciled_at_ms bigint;

-- The sweep's walk order: the status filter, then the least-recently visited
-- row first (never visited before any visited), oldest incarnation first
-- among equals.
CREATE INDEX IF NOT EXISTS sandbox_sessions_reconcile_order
  ON app.sandbox_sessions (status, last_reconciled_at_ms NULLS FIRST, created_at_ms);
