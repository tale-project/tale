-- 0.5 app migration 0074: one PENDING approval per connector operation.
--
-- Why: the approvals gate (`domains/approvals/gate.ts`) keys a live
-- connector write to its operation (`resource_type = 'connector_operation'`,
-- `resource_id` = the dispatcher's idempotency key) and was check-then-
-- insert. SELECT … FOR UPDATE over zero rows locks nothing, so two
-- evaluations racing for one operation both minted a pending row. Re-entry
-- reads the newest row (ORDER BY seq DESC), so a decision on the newer card
-- left the older one pending forever — a duplicate card nobody can resolve,
-- inflating the pending count for good. The gate's contract becomes the
-- schema's: at most one pending row per operation. The gate inserts with
-- ON CONFLICT, and the loser of a race answers with the winner's card.
--
-- Scoped to connector operations on purpose: the task-review lane
-- (`resource_type = 'task_review'`) supersedes its own stale pending rows
-- when a new round is minted (tasks/reviews.ts), and other kinds may hold
-- several open questions per resource legitimately.
--
-- Existing duplicates: per operation the NEWEST pending row is the one the
-- gate answers with, so it stays. Older pending twins are closed the way the
-- review lane closes a superseded round — `rejected`, with
-- `metadata.supersededBy` naming the survivor — never deleted: the ledger
-- keeps every row it minted.
--
-- Rolling-deploy safe: the previous image's insert only ever races itself
-- for one operation; where it used to mint a twin it now fails that one
-- evaluation with a unique violation the dispatcher surfaces and the caller
-- retries into the surviving card. Nothing it reads changes shape.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, resource_type, resource_id ORDER BY seq DESC
         ) AS rn,
         first_value(id) OVER (
           PARTITION BY org_id, resource_type, resource_id ORDER BY seq DESC
         ) AS survivor_id
  FROM app.approvals
  WHERE resource_type = 'connector_operation' AND status = 'pending'
)
UPDATE app.approvals a SET
  status = 'rejected',
  reviewed_at_ms = (extract(epoch FROM now()) * 1000)::bigint,
  metadata = coalesce(a.metadata, '{}'::jsonb)
             || jsonb_build_object('supersededBy', ranked.survivor_id)
FROM ranked
WHERE a.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_connector_operation
  ON app.approvals (org_id, resource_type, resource_id)
  WHERE resource_type = 'connector_operation' AND status = 'pending';
