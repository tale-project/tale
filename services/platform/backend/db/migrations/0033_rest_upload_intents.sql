-- 0.5 app migration 0033: the REST upload handshake — a presigned PUT minted
-- by `POST /api/v1/projects/{id}/uploads` is tracked by a single-use intent
-- row, and `POST …/files` may bind a blob into a project document only by
-- consuming the matching unconsumed, unexpired intent (same org, user,
-- project, and s3 ref). Without the row, a caller could bind arbitrary
-- org-scoped keys it never uploaded. Consumed/expired rows are swept lazily
-- by the mint path (lazy cleanup over cron, the house rule).

CREATE TABLE app.rest_upload_intents (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  project_id text NOT NULL,
  s3_ref text NOT NULL,
  expires_at_ms bigint NOT NULL,
  consumed_at_ms bigint,
  created_at_ms bigint NOT NULL
);

-- One intent per blob ref: the bind consume keys on it, and a re-mint of the
-- same key is a bug upstream (object keys are random per handoff).
CREATE UNIQUE INDEX rest_upload_intents_ref ON app.rest_upload_intents (s3_ref);
CREATE INDEX rest_upload_intents_org_expiry
  ON app.rest_upload_intents (org_id, expires_at_ms);

-- Project-scoped external-ref dedupe for `POST /api/v1/tasks` (one task per
-- issue per PROJECT) — the org-scoped twin already exists as
-- tasks_org_external.
CREATE INDEX tasks_project_external
  ON app.tasks (project_id, external_system, external_id);
