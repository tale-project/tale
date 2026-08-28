-- 0.5 app migration 0032: two-factor enforcement state — the verify-endpoint
-- lockout counters (a failed TOTP is a failed password in brute-force
-- terms; keyed by userId because the verify request carries no email) and
-- the per-user enforcement grace anchor (set once on first sign-in under an
-- enforced policy; later policy edits never reset a running clock).

CREATE TABLE app.two_factor_attempts (
  user_id text PRIMARY KEY,
  consecutive_failures int NOT NULL DEFAULT 0,
  last_failure_at_ms bigint NOT NULL,
  locked_until_ms bigint
);

CREATE INDEX two_factor_attempts_last_failure
  ON app.two_factor_attempts (last_failure_at_ms);

CREATE TABLE app.two_factor_grace (
  user_id text PRIMARY KEY,
  grace_until_ms bigint NOT NULL
);
