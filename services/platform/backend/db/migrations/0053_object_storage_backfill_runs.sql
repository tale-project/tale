-- 0.5 app migration 0053: per-org object-storage blob backfill runs (the
-- 0.4 `objectStorageBackfillRuns`). In 0.5 blobs already live in S3 keys;
-- the backfill COPIES an org's objects from the deployment-default store
-- into its own BYO bucket (full data residency) — refs stay identical, so
-- reads flip over the moment the copy lands. One active run per org.
CREATE TABLE app.object_storage_backfill_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  org_slug text NOT NULL,
  dry_run boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  phase text NOT NULL CHECK (phase IN ('documents', 'fileMetadata', 'done')),
  continuation text,
  rows_scanned int NOT NULL DEFAULT 0,
  migrated int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  bytes_migrated bigint NOT NULL DEFAULT 0,
  candidates int NOT NULL DEFAULT 0,
  candidate_bytes bigint NOT NULL DEFAULT 0,
  sample jsonb NOT NULL DEFAULT '[]',
  triggered_by text NOT NULL,
  started_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  finished_at_ms bigint,
  last_error text
);
CREATE INDEX object_storage_backfill_runs_org
  ON app.object_storage_backfill_runs (org_id, started_at_ms DESC);
CREATE UNIQUE INDEX object_storage_backfill_one_running
  ON app.object_storage_backfill_runs (org_id)
  WHERE status = 'running';
