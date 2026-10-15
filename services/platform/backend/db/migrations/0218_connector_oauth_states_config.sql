-- A connector consent carries the settings its new credential is born with
--
-- An Add's consent (Settings > Connectors > Add credential > Connect) stores
-- a new credential when it comes back. Some per-credential settings decide
-- what that credential is: Outlook's `mailbox` names the shared mailbox it
-- works in, the extra permissions the consent must ask for, and — because
-- it is fixed once the credential exists — what the mail sync's positions,
-- the conversations it files and their replies belong to. A credential
-- added without it and edited afterwards was, for a while, a credential on
-- the person's own mailbox, and the mail sync could file that mailbox's
-- mail into the organization's Inbox before the edit.
--
--   config  the settings the person entered beside Connect, normalized by
--           the start door with the rules a credential is created by
--           (`{"mailbox": "promotion@example.com"}`); NULL for a Reconnect,
--           which keeps its credential's own, and for an Add without any.
--           The callback creates the credential with them.
--
-- Rolling-deploy safe: the column is nullable, and a pending row lives ten
-- minutes. A consent the previous image started carries no settings, as
-- before. One this image started and the previous image completes stores
-- the credential without them — the old behaviour, for those minutes only.

ALTER TABLE app.connector_oauth_states
  ADD COLUMN IF NOT EXISTS config jsonb;
