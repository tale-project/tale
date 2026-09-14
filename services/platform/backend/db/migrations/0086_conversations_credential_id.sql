-- 0.5 app migration 0086: which CREDENTIAL a conversation is carried on.
--
-- A conversation has always recorded its connector (`connector_name`) but never
-- which of that connector's credentials it belongs to, and the send lane calls
-- the connector without naming one — which resolves to the organization's
-- DEFAULT credential for that slug.
--
-- On email that is survivable: the mailbox the customer wrote to travels in
-- `metadata.to`, and the send passes it as the From the imap-smtp native
-- resolves against. Off email there is no such proxy. An external channel's
-- destination lives ONLY on its credential, so an organization running two
-- products through one Inbox would have both conversations stamped with the
-- same connector slug and every reply delivered to whichever credential is
-- marked default — one product's customer reply posted to the other product's
-- server.
--
-- Nullable, and null keeps today's behaviour exactly: resolve the default. Every
-- existing row stays valid and every mail conversation keeps working unchanged.
-- New conversations on a channel whose destination is credential-bound record
-- the credential at intake, and the send names it.

ALTER TABLE app.conversations ADD COLUMN credential_id text;

-- Read on the send path by conversation id, so no index of its own is needed.
-- This one answers the operational question instead: what breaks if a
-- credential is deleted or disabled.
CREATE INDEX conversations_org_credential
  ON app.conversations (org_id, credential_id)
  WHERE credential_id IS NOT NULL;
