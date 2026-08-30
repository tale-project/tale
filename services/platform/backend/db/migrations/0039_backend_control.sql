-- Deploy-drain control plane (the 0.4 `backendControl` singleton): `tale
-- deploy` flips `draining` so the chat doors refuse NEW turns while
-- in-flight generations finish, then clears it after the restart. The
-- expiry bounds a crashed deploy's blast radius — a stale flag reads as
-- "not draining".
CREATE TABLE app.backend_control (
  key text PRIMARY KEY,
  draining boolean NOT NULL DEFAULT false,
  drain_started_at_ms bigint,
  drain_expires_at_ms bigint,
  updated_at_ms bigint NOT NULL
);
