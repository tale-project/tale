-- How far each person has read the organization's bell, per category.
--
-- The bell's unread count used to read every notification of the
-- organization and probe `app.notification_reads` for each, and Read all
-- inserted one read row per notification: both grew with the organization's
-- whole history (`backend/domains/notifications/service.ts`). A watermark
-- names the newest notification a person has read up to, in the bell's own
-- order (`created_at_ms DESC, id DESC`, which `notifications_org_created`
-- serves). Read all moves it, the count reads only what came after it, and
-- `app.notification_reads` keeps only what was read one by one above it.
--
-- One row per category, not per person: `security` notifications are for
-- admins only, so a member's Read all moves the `system` watermark alone.
-- Made an admin later, that person still finds the security notifications
-- they never saw unread.
--
-- No foreign key to `app.notifications`: a watermark is a position in the
-- order, and the notification it names may be deleted by retention or
-- erasure without moving it.
--
-- Rolling-deploy safe: a new table, which the previous image never reads.

CREATE TABLE IF NOT EXISTS app.notification_read_watermarks (
  org_id text NOT NULL,
  user_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('security', 'system')),
  -- The newest notification of this category the person has read up to:
  -- its `created_at_ms` and `id`, compared as a pair in the bell's order.
  read_up_to_ms bigint NOT NULL,
  read_up_to_id text NOT NULL,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, user_id, category)
);
