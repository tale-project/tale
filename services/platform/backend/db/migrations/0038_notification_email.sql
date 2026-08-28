-- The debounced actionable-email sink: every actionable write bumps the
-- epoch and schedules a `notification.email` job carrying it; the job sends
-- only when its epoch is still the row's current one, so a rewrite inside
-- the debounce window makes the older job a no-op (the 0.4 cancel+reschedule
-- semantics, safe under at-least-once delivery). An undo deletes the row and
-- the fired job skips the missing id.
ALTER TABLE app.user_notifications
  ADD COLUMN email_epoch bigint NOT NULL DEFAULT 0;
