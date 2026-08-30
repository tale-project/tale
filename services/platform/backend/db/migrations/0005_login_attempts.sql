-- 0.5 app migration 0005: sign-in throttling state.
--
-- `login_attempts`: one row per account email currently carrying failures
-- (cleared on success — cleanup-on-success keeps the table small).
-- `login_block_counters`: hourly coalesced counters for attempts the auth
-- before-hook rejected (lockout / per-IP flood) — one audit row per rejected
-- request would flood the chain under a brute-force run.

CREATE TABLE app.login_attempts (
  email text PRIMARY KEY,
  consecutive_failures int NOT NULL,
  last_failure_at bigint NOT NULL,
  locked_until bigint
);

-- Retention sweep walks expired rows by age, not table size.
CREATE INDEX login_attempts_last_failure
  ON app.login_attempts (last_failure_at);

CREATE TABLE app.login_block_counters (
  email text NOT NULL,
  -- Epoch ms at the start of the hour bucket.
  window_start bigint NOT NULL,
  lockout_count int NOT NULL DEFAULT 0,
  ip_limit_count int NOT NULL DEFAULT 0,
  -- Most recent IP seen in this bucket (informational, for triage).
  last_ip text,
  updated_at bigint NOT NULL,
  PRIMARY KEY (email, window_start)
);

CREATE INDEX login_block_counters_window
  ON app.login_block_counters (window_start);
