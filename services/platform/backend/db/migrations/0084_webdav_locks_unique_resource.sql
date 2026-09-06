-- WebDAV write locks: at most one row per (org, resource path).
--
-- RFC 4918 exclusive locks are mutually exclusive, but `createLock` guarded
-- that with a check-then-insert — a `FOR UPDATE` over an empty result locks
-- nothing — so two concurrent LOCKs on an unlocked path could both land and
-- hand out two "exclusive" tokens, one of which every later `If:` check
-- ignored (the path lookup reads LIMIT 1). The rule now lives in the schema:
-- the plain (org_id, resource_path) index becomes unique and the writer maps
-- a violation to 423.
--
-- Rolling-deploy safe: duplicates a past race left behind are reduced to the
-- row that expires last before the index is built; the previous image's
-- writes keep working (it already refused a second LOCK on a live path).

DELETE FROM app.webdav_locks l
USING app.webdav_locks other
WHERE l.org_id = other.org_id
  AND l.resource_path = other.resource_path
  AND (l.expires_at_ms, l.id) < (other.expires_at_ms, other.id);

DROP INDEX IF EXISTS app.webdav_locks_org_resource;
CREATE UNIQUE INDEX IF NOT EXISTS webdav_locks_org_resource
  ON app.webdav_locks (org_id, resource_path);
