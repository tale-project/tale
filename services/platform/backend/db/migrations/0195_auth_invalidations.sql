-- 0.5 app migration 0195: the log that tells every API process which
-- cached sessions and memberships to drop.
--
-- Every API process keeps the sessions and memberships it resolved for a
-- few seconds (`auth/request-cache.ts`), so an ordinary request costs no
-- authentication reads. What makes that safe is this log: a trigger on
-- Better Auth's `session`, `user` and `member` tables writes one row per
-- change that a cached copy must not outlive — whoever writes the table,
-- Better Auth, a domain service or plain SQL — and every process tails it
-- about four times a second. A process that cannot read the log stops
-- answering from its cache.
--
-- The triggers themselves are installed at boot, after Better Auth's own
-- migrator (`installAuthInvalidationTriggers` in `db/migrate.ts`): these
-- files run before Better Auth creates its tables on a fresh database. The
-- functions live here, with the table they write.
--
-- In `app_realtime` beside the hint outbox: like the outbox it is a bus,
-- read by every process and reclaimed by the worker's `reclaim_outbox` job
-- once every process has read past it.
CREATE TABLE IF NOT EXISTS app_realtime.auth_invalidations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 'session': `subject_id` is a session id; 'user': a user id, whose
  -- sessions and memberships all go; 'member': a user id, whose memberships
  -- go.
  kind text NOT NULL,
  subject_id text NOT NULL,
  -- The writing transaction. A reader cannot take ids in order (a
  -- transaction that drew a lower id can commit after a higher one), so it
  -- reads every row of a transaction that may still have been running at
  -- its previous read: `writer_xid >= pg_snapshot_xmin` of that read.
  writer_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at_ms bigint NOT NULL
    DEFAULT (extract(epoch FROM clock_timestamp()) * 1000)::bigint
);

CREATE INDEX IF NOT EXISTS auth_invalidations_writer_xid
  ON app_realtime.auth_invalidations (writer_xid);
CREATE INDEX IF NOT EXISTS auth_invalidations_created_at_ms
  ON app_realtime.auth_invalidations (created_at_ms);

-- A session that ended, or changed in anything but its sliding refresh
-- (`expiresAt`, `updatedAt` — Better Auth's refresh, which the cache tracks
-- itself, see the trigger's WHEN in `db/migrate.ts`). A session deleted
-- after it expired needs no row: no cache serves an expired session.
CREATE OR REPLACE FUNCTION app_realtime.auth_session_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."expiresAt" > now() THEN
      INSERT INTO app_realtime.auth_invalidations (kind, subject_id)
      VALUES ('session', OLD.id);
    END IF;
    RETURN NULL;
  END IF;
  INSERT INTO app_realtime.auth_invalidations (kind, subject_id)
  VALUES ('session', OLD.id);
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    INSERT INTO app_realtime.auth_invalidations (kind, subject_id)
    VALUES ('session', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

-- A user changed or removed: a cached session carries the user's row, and
-- the org gate reads its two-factor flag from it.
CREATE OR REPLACE FUNCTION app_realtime.auth_user_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app_realtime.auth_invalidations (kind, subject_id)
  VALUES ('user', OLD.id);
  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    INSERT INTO app_realtime.auth_invalidations (kind, subject_id)
    VALUES ('user', NEW.id);
  END IF;
  RETURN NULL;
END
$$;

-- A membership added, changed (a role, a disable) or removed — an
-- organization's deletion removes its members, row by row.
CREATE OR REPLACE FUNCTION app_realtime.auth_member_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app_realtime.auth_invalidations (kind, subject_id)
    VALUES ('member', NEW."userId");
    RETURN NULL;
  END IF;
  INSERT INTO app_realtime.auth_invalidations (kind, subject_id)
  VALUES ('member', OLD."userId");
  IF TG_OP = 'UPDATE' AND NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    INSERT INTO app_realtime.auth_invalidations (kind, subject_id)
    VALUES ('member', NEW."userId");
  END IF;
  RETURN NULL;
END
$$;
