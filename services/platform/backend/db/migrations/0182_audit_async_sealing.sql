-- 0.5 app migration 0182: seal the audit chain off the write path.
--
-- Every audited write used to append to its organization's chain inside the
-- writer's own transaction: the chain head locked FOR UPDATE, the prior hash
-- read, the new row hashed and the head bumped, all held until COMMIT. An
-- organization's audited writes therefore ran one at a time — about a
-- hundred a second — and under SERIALIZABLE every concurrent head bump cost
-- the loser a retry. A writer now inserts its row unsealed (no hash), and the
-- worker's sealer seals each organization's unsealed rows in batches, within
-- seconds.
--
-- The chain's order is now the order rows are sealed in, recorded as
-- `chain_seq`: `ts` stays the moment the event happened, and a transaction
-- that commits late is sealed after rows that carry a later `ts`. Rows sealed
-- before this migration keep `chain_seq` NULL and come first, in their
-- (ts, id) order — the order they were chained in.

ALTER TABLE app.audit_logs ALTER COLUMN integrity_hash DROP NOT NULL;

-- Position in the org's chain; NULL on a row sealed before this migration
-- (chained in (ts, id) order) and on a row not sealed yet.
ALTER TABLE app.audit_logs ADD COLUMN IF NOT EXISTS chain_seq bigint;

-- The chain_seq of the org's newest sealed row.
ALTER TABLE app.audit_chain_heads
  ADD COLUMN IF NOT EXISTS last_seq bigint NOT NULL DEFAULT 0;

-- One position per row, and the walk the verifier and the retention sweep
-- take through the chain.
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_org_chain_seq
  ON app.audit_logs (org_id, chain_seq) WHERE chain_seq IS NOT NULL;

-- The sealer's queue: what is written and not sealed yet, oldest first.
CREATE INDEX IF NOT EXISTS audit_logs_unsealed
  ON app.audit_logs (org_id, ts, id) WHERE integrity_hash IS NULL;

-- The verifier's resume point once it has passed the rows sealed before
-- this migration.
ALTER TABLE app.audit_integrity_progress
  ADD COLUMN IF NOT EXISTS last_verified_seq bigint;

-- An image from before this migration still appends sealed rows inline
-- while a rolling deploy runs, under the chain head it holds locked. Each
-- such row takes the next position from that head, so the chain's order
-- stays total; the sealer sets chain_seq itself and never inserts.
CREATE OR REPLACE FUNCTION app.audit_logs_stamp_inline_seal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.integrity_hash IS NOT NULL AND NEW.chain_seq IS NULL THEN
    INSERT INTO app.audit_chain_heads (org_id) VALUES (NEW.org_id)
    ON CONFLICT (org_id) DO NOTHING;
    UPDATE app.audit_chain_heads SET last_seq = last_seq + 1
    WHERE org_id = NEW.org_id
    RETURNING last_seq INTO NEW.chain_seq;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_stamp_inline_seal ON app.audit_logs;
CREATE TRIGGER audit_logs_stamp_inline_seal
  BEFORE INSERT ON app.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.audit_logs_stamp_inline_seal();
