-- The emails already read at each mail-sync position, kept with the position.
--
-- A mailbox's position per folder (`mail_sync_inbound_since_ms`,
-- `mail_sync_outbound_since_ms`, 0035) is the instant on the provider's own
-- clock up to which every email has been read. Gmail's search reads whole
-- seconds, so a pass lists the emails of the position's own second again; a
-- pass that counted them as new could fill every window with them and never
-- move again. The sync therefore keeps, per folder, the ids of the emails read
-- in the position's second, and leaves them out of the next listing.
--
--   mail_sync_edges  {"inbox": {"at": <position ms>, "ids": [<provider id>]},
--                     "sent":  {...}} — an entry counts only while `at`
--                    equals the folder's position; NULL until a sync keeps
--                    one. Outlook and IMAP never need one: their listings
--                    start strictly after the position.
--
-- Rolling-deploy safe: the previous image never reads the column, and a
-- position it moves leaves the entry's `at` behind, so the new image ignores
-- the stale entry.

ALTER TABLE app.connector_credentials
  ADD COLUMN IF NOT EXISTS mail_sync_edges jsonb;
