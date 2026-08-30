-- 0.5 app migration 0004: unsharded rate-limit state.
--
-- One row per (rule name, subject key). Both limiter kinds share the row:
--   token bucket → value = tokens remaining, ts = last refill (epoch ms)
--   fixed window → value = consumed count,  ts = window start (epoch ms)
-- All transitions are single atomic UPSERTs (see backend/lib/rate_limit.ts);
-- 0.4's shard fields die — Postgres row locking replaces OCC spreading.

CREATE TABLE app.rate_limits (
  name text NOT NULL,
  key text NOT NULL,
  value double precision NOT NULL,
  ts bigint NOT NULL,
  PRIMARY KEY (name, key)
);
