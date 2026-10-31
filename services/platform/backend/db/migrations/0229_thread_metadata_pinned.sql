-- A person's pinned chats, newest pin first, through an index of their own.
--
-- The chat list reads one page at a time: the caller's pinned threads first,
-- newest pin first, then the rest, newest activity first (`listThreads` in
-- `backend/domains/chat/threads.ts`). The rest walk 0012's `threads_org_user
-- (org_id, user_id, updated_at_ms DESC)`. Nothing served the pins, which only
-- `thread_metadata` holds: 0012's `thread_metadata_org_user (org_id, user_id)`
-- reads every thread the person has, pinned or not, before it can return one
-- pin, and every first page starts with the pins.
--
-- Partial: only pinned rows enter it, a handful per person, so the writes of
-- every other thread pay nothing for it. The read states
-- `tm.pinned_at_ms IS NOT NULL` literally, which proves the predicate in
-- custom and generic plans alike; `thread_id` breaks a tie between two pins
-- of the same millisecond, the order the list's cursor continues in.
--
-- Plain CREATE INDEX: a migration runs in one transaction, so CONCURRENTLY is
-- unavailable; thread metadata writes wait for one pass over the table while
-- it builds, and reads go on. Rolling-deploy safe: an index only, which the
-- previous image's reads may use as well.

CREATE INDEX IF NOT EXISTS thread_metadata_pinned
  ON app.thread_metadata (org_id, user_id, pinned_at_ms DESC, thread_id DESC)
  WHERE pinned_at_ms IS NOT NULL;
