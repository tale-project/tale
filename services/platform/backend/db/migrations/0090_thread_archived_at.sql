-- 0.5 app migration 0090: when a chat thread was archived.
--
-- Archiving is a metadata edit that deliberately leaves `app.threads.
-- updated_at_ms` alone (the list is ordered by message activity, and an
-- archive must not reorder it), so nothing recorded WHEN a thread was
-- archived or restored — a client mirroring threads incrementally by
-- `updatedAt` could never see the archive happen. This column is that
-- moment: stamped by the archive toggle (app and REST), cleared by the
-- restore, and answered by the REST door as `Thread.archivedAt`.
--
--   archived_at_ms  epoch millis of the archive; NULL while the thread is
--                   active — and NULL on a thread archived before this
--                   column existed, whose moment nobody recorded (the flag
--                   `archived` stays the authority on the state itself).
--
-- Rolling-deploy safe: nullable, no backfill (there is no honest value for
-- rows archived before the deploy), and the previous image never reads it.

ALTER TABLE app.thread_metadata
  ADD COLUMN IF NOT EXISTS archived_at_ms bigint;
