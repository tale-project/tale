-- 0.5 app migration 0052: the scheduled audit-chain integrity check's
-- per-org progress row (the 0.4 `auditIntegrityProgress`). The daily job
-- resumes from (last_verified_ts, last_verified_id, last_verified_hash);
-- a detected break stamps the alert fingerprint until a later clean pass
-- over the same region clears it.
CREATE TABLE app.audit_integrity_progress (
  org_id text PRIMARY KEY,
  last_verified_ts bigint,
  last_verified_id text,
  last_verified_hash text,
  head_reached boolean NOT NULL DEFAULT false,
  updated_at_ms bigint NOT NULL,
  last_alerted_fingerprint text,
  last_alerted_at_ms bigint
);
