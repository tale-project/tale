-- What a pending connector consent is FOR travels with its state row, so the
-- callback never has to guess it. Before this, every completed consent for a
-- connector without a workspace id (Gmail, Outlook, Google Drive, Teams)
-- renewed the connector's default grant: a second account added through Add
-- credential silently replaced the first, and Reconnect on any other row
-- rewrote the default instead (#3711).
--
-- `reconnect_credential_id` names the credential a Reconnect renews — the one
-- the start door checked belongs to this organization and connector and is an
-- OAuth grant. NULL is an Add: the consent stores a NEW credential. The value
-- lives only on the server-side row keyed by the state's hash, so nothing on
-- the callback request can re-target it.
--
-- No foreign key, on purpose. The target can be deleted while the vendor asks
-- for consent: CASCADE would drop the pending row (the user would read "link
-- expired"), SET NULL would quietly turn the Reconnect into an Add, and a
-- plain reference would block the delete. The callback re-reads the target
-- under a row lock instead and refuses with its own page when it is gone.
--
-- Rolling-deploy safe: the column is nullable and the previous image neither
-- writes nor reads it. Its pending rows read as Add here, which never
-- overwrites a credential; a consent this image starts and the previous image
-- completes takes the previous image's path, as every consent does today.

ALTER TABLE app.connector_oauth_states
  ADD COLUMN IF NOT EXISTS reconnect_credential_id text;
