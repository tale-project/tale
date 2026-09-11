-- 0.5 app migration 0089: recoverable spend settlement + budget reservations
-- on sandbox session ops.
--
-- A managed harness turn mints a gateway virtual key whose cumulative spend
-- is read back when the turn ends and booked into the org usage ledger. The
-- settle used to be one shot: a gateway hiccup between the finalize claim
-- and the spend read lost the figure forever, a failed remote DELETE was
-- still marked revoked locally, and the deadline/teardown paths deleted the
-- key without reading its spend at all. These columns make every step of the
-- settlement durable on its own, so a retry — the settle's own reconcile
-- job, the sandbox watchdog's sweep, a session teardown — resumes exactly
-- where the last attempt stopped:
--
--   budget_cents         the turn's gateway allowance, reserved BEFORE the
--                        key is minted. An op whose spend is not yet booked
--                        holds its reservation against the org's spend cap,
--                        so concurrent turns cannot each read the same
--                        remaining balance and collectively overshoot it.
--   spend_settled_at_ms  when the key's cumulative spend was read from the
--                        gateway and booked (op row + usage ledger). NULL on
--                        an unsettled op; an op that never minted a key is
--                        stamped when it finalizes (nothing to settle), which
--                        also releases its reservation.
--   key_revoked_at_ms    when the gateway CONFIRMED the key's deletion. NULL
--                        while the key may still be live remotely — the
--                        token row's revoked_at_ms now means the same thing.

ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS budget_cents double precision,
  ADD COLUMN IF NOT EXISTS spend_settled_at_ms bigint,
  ADD COLUMN IF NOT EXISTS key_revoked_at_ms bigint;

-- Ops that finalized under the one-shot settle were settled as well as that
-- code could (a lost figure is lost); marking them done keeps the reconcile
-- sweep from re-reading months of deleted keys after the deploy. Ops still
-- running settle through the new path when their turn ends.
UPDATE app.sandbox_session_ops
SET spend_settled_at_ms = coalesce(finished_at_ms, finalized_at_ms),
    key_revoked_at_ms = CASE WHEN minted_key_id IS NULL THEN NULL
      ELSE coalesce(finished_at_ms, finalized_at_ms) END
WHERE finalized_at_ms IS NOT NULL AND spend_settled_at_ms IS NULL;

-- The reservation sums (per org, per user) and the reconcile sweep walk only
-- ops whose settlement is still open — a small, fast-churning set.
CREATE INDEX IF NOT EXISTS sandbox_session_ops_open_settlement
  ON app.sandbox_session_ops (org_id, finalized_at_ms)
  WHERE spend_settled_at_ms IS NULL
     OR (minted_key_id IS NOT NULL AND key_revoked_at_ms IS NULL);
