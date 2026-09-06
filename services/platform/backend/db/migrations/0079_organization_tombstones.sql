-- Organization slug tombstones — slugs whose corpus, blobs and config tree
-- are still being torn down after the organization row was deleted.
--
-- The slug is the tenant key of everything that lives OUTSIDE the app schema:
-- the knowledge corpus rows (`org_slug`), the object-store blobs
-- (`<prefix>/<slug>/<uuid>`) and the config tree (`$TALE_CONFIG_DIR/<slug>`).
-- `deleteOrganization` removes the app-schema rows inside its own transaction
-- and hands those slug-keyed remains to the `org.cleanup_files` job. Until
-- that job has finished, a new organization must not take the slug: it would
-- route onto the deleted tenant's corpus and blobs. A row here is written in
-- the deletion transaction, checked by the organization create/update slug
-- hooks, and removed by the job as its LAST step — so a slug is reusable
-- exactly when nothing of the old tenant is left behind.
--
-- Rolling-deploy safe: the previous image is still serving while this applies.

CREATE TABLE IF NOT EXISTS app.organization_tombstones (
  slug text PRIMARY KEY,
  -- The deleted organization's id — the job's log line and the audit trail.
  org_id text NOT NULL,
  -- The deleting user's id (null when the deletion had no user actor).
  deleted_by text,
  deleted_at_ms bigint NOT NULL
);
