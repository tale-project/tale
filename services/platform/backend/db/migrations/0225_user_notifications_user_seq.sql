-- A person's bell, newest first, through an index of its own.
--
-- The bell's "All" page reads one person's rows in one organization, newest
-- first, a page at a time behind a `seq` cursor (`listMyNotifications` in
-- `backend/domains/collab/service.ts`, under `GET /api/app/collab/notifications`
-- and the personal stream's `GET /notifications/sync`, which walks every
-- page). No index served that order: 0028's `user_notifications_user_unread`
-- puts `read` before `seq`, and `user_notifications_user_created` orders by
-- `created_at_ms`, so each page read every row the person has and sorted them
-- before its `LIMIT`. Through this index the cursor bounds the scan and the
-- `LIMIT` ends it, so a page reads one page of entries; the read writes its
-- cursor only when it has one, so a generic plan bounds the scan as well.
-- `user_notifications_user_unread` still holds the "Unread" page's rows in that
-- order, behind `read`.
--
-- `user_notifications_user_created` stays: it is the only index that holds
-- `created_at_ms`, which the retention sweep's cut-off filters on.
--
-- Plain CREATE INDEX: a migration runs in one transaction, so CONCURRENTLY is
-- unavailable; notification writes wait for one pass over the table while it
-- builds, and reads go on. Rolling-deploy safe: an index only, which the
-- previous image's reads may use as well.

CREATE INDEX IF NOT EXISTS user_notifications_user_seq
  ON app.user_notifications (user_id, org_id, seq DESC);
