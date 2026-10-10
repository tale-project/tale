-- Messages an automation step sends to members (`notify.member`, the
-- personal-bell type `automation_message`).
--
--   notification_preferences.automation_messages
--       Whether the member wants them: tri-state like every column 0028
--       made — NULL follows the default, which is ON. Off, a step's
--       message to them is skipped, and the step's output lists them as
--       skipped, so the author sees who was not told.
--
--   user_notifications_automation_run
--       The rows one run sent, by run. A step reads them twice: to count
--       what the run has sent against its cap (a run in a loop must not
--       flood the organization's bells), and to find the rows an earlier
--       try of the same step execution already wrote, so a retry delivers
--       each message once. Partial on the type, so it holds only these
--       rows and costs the bell's other writes nothing.
--
-- Rolling deploy: the previous image never reads the column, never writes
-- the type, and the index serves only the new image's reads. No backfill:
-- every member starts on the default.

ALTER TABLE app.notification_preferences
  ADD COLUMN IF NOT EXISTS automation_messages boolean;

CREATE INDEX IF NOT EXISTS user_notifications_automation_run
  ON app.user_notifications (org_id, resource_id)
  WHERE type = 'automation_message';
