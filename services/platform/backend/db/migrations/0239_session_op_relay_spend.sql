-- What the in-process model relay has booked on a turn's op.
--
-- A managed harness turn calls its models under a key minted for its op
-- (`minted_key_id`). The sandbox LLM gateway kept what such a key spent in
-- a counter of its own, which the settlement read before it deleted the key.
-- The relay that replaces the gateway inside the backend
-- (`domains/llm_relay`, tale-project/tale#4942) books each call on the op
-- row itself when the call ends, on whichever backend replica served it —
-- so two replicas, or two colours during a deploy, share one figure:
--
--  - `relay_spent_cents`: what the turn's model calls have cost so far, at
--    the model's catalog price. Every call's admission reads it against the
--    turn's allowance (`budget_cents`, less the images booked and held), and
--    the settlement books it as the spend of a relay key.
--  - `relay_input_tokens`, `relay_cache_read_tokens`,
--    `relay_cache_write_tokens`, `relay_output_tokens`: the counts behind
--    it — uncached input, prompt-cache reads and writes, and output
--    (reasoning included) — as the vendor reported them, or as the relay
--    counted them for a call that ended before the vendor said.
--  - `relay_calls`: how many calls it booked.
--
-- NOT NULL DEFAULT 0: an op the gateway served reads 0 here, and nothing
-- reads these for a gateway key. Each call adds to them in one UPDATE, so
-- concurrent calls of one turn never lose each other's spend. No backfill.
-- Rolling-deploy safe: the previous image neither reads nor writes them.

ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS relay_spent_cents double precision NOT NULL
    DEFAULT 0 CHECK (relay_spent_cents >= 0),
  ADD COLUMN IF NOT EXISTS relay_input_tokens bigint NOT NULL
    DEFAULT 0 CHECK (relay_input_tokens >= 0),
  ADD COLUMN IF NOT EXISTS relay_cache_read_tokens bigint NOT NULL
    DEFAULT 0 CHECK (relay_cache_read_tokens >= 0),
  ADD COLUMN IF NOT EXISTS relay_cache_write_tokens bigint NOT NULL
    DEFAULT 0 CHECK (relay_cache_write_tokens >= 0),
  ADD COLUMN IF NOT EXISTS relay_output_tokens bigint NOT NULL
    DEFAULT 0 CHECK (relay_output_tokens >= 0),
  ADD COLUMN IF NOT EXISTS relay_calls integer NOT NULL
    DEFAULT 0 CHECK (relay_calls >= 0);

-- The admission and the booking find an op by its key: the token a call
-- presents names the key, never the op.
CREATE INDEX IF NOT EXISTS sandbox_session_ops_minted_key_idx
  ON app.sandbox_session_ops (minted_key_id)
  WHERE minted_key_id IS NOT NULL;
