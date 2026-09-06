-- Widen the one-live-erasure-per-subject index to blocked and partial receipts.
--
-- 0031 encoded "one live request per subject" as a partial unique index over
-- `status IN ('pending', 'running')`, while `requestErasure`'s duplicate
-- handler — and the Retry door — treat `blocked` and `partial` receipts as
-- live too: both re-arm through Retry rather than a fresh filing. With the
-- narrower index a second admin could file again against a subject whose
-- first receipt sat blocked under a hold (or partial after a failed pass),
-- and once the hold lifted both receipts could run the cascade — two
-- receipts and two `gdpr_erasure_executed` rows claiming the same erasure.
-- The index now matches the code's own notion of live. `failed` stays
-- outside on purpose: a watchdog-failed receipt is NOT retriable and the
-- documented remedy is a new filing.
--
-- Existing duplicates are settled first so the wider index can build: per
-- (org, subject) the receipt furthest along survives (running > pending >
-- partial > blocked, newest first on a tie) and the rest land in the
-- terminal `cancelled` state with a system cancellation reason — the rows
-- stay as receipts, they simply stop being re-armable. A loser parked for
-- dual approval keeps a pending approvals-inbox card; that card is settled
-- as rejected the way `cancelErasure` settles it (0074 shape: status +
-- reviewed_at_ms + a supersededBy marker), so nothing stays decidable for a
-- receipt that can no longer run.
--
-- Rolling-deploy safe: the previous image only ever inserts `pending` rows,
-- which the wider index covers exactly as the old one did.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, target_user_id
           ORDER BY CASE status
                      WHEN 'running' THEN 0
                      WHEN 'pending' THEN 1
                      WHEN 'partial' THEN 2
                      ELSE 3
                    END,
                    requested_at_ms DESC, id DESC
         ) AS rank,
         first_value(id) OVER (
           PARTITION BY org_id, target_user_id
           ORDER BY CASE status
                      WHEN 'running' THEN 0
                      WHEN 'pending' THEN 1
                      WHEN 'partial' THEN 2
                      ELSE 3
                    END,
                    requested_at_ms DESC, id DESC
         ) AS survivor_id
  FROM app.gdpr_erasure_requests
  WHERE status IN ('pending', 'running', 'blocked', 'partial')
),
settled AS (
  UPDATE app.gdpr_erasure_requests AS r SET
    status = 'cancelled',
    cancelled_by = 'system',
    cancellation_reason = 'Superseded by a later live erasure request for the same subject (migration 0081).',
    finished_at_ms = (extract(epoch FROM now()) * 1000)::bigint
  FROM ranked
  WHERE r.id = ranked.id AND ranked.rank > 1
  RETURNING r.id, r.org_id, ranked.survivor_id
)
UPDATE app.approvals AS a SET
  status = 'rejected',
  reviewed_at_ms = (extract(epoch FROM now()) * 1000)::bigint,
  metadata = coalesce(a.metadata, '{}'::jsonb)
             || jsonb_build_object('supersededBy', settled.survivor_id)
FROM settled
WHERE a.org_id = settled.org_id
  AND a.resource_type = 'erasure'
  AND a.resource_id = settled.id
  AND a.status = 'pending';

DROP INDEX IF EXISTS app.gdpr_erasure_one_live_per_subject;
CREATE UNIQUE INDEX IF NOT EXISTS gdpr_erasure_one_live_per_subject
  ON app.gdpr_erasure_requests (org_id, target_user_id)
  WHERE status IN ('pending', 'running', 'blocked', 'partial');
