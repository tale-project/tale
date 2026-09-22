-- A message remembers WHICH mailbox carried it.
--
-- `connector_name` names the connector (`gmail`), never the account. An
-- organization may hold many credentials per connector
-- (`connector_credentials_org_connector`, 0035), and the mail sync fans out
-- over every active one, so two threads with `connector_name = 'gmail'` can
-- have arrived at two different mailboxes. The reply had no way to tell them
-- apart: it resolved no credential and fell through to the org's `is_default`
-- for that slug, so a thread received on one mailbox could be answered from
-- another.
--
-- Nullable and unset for existing rows: a message stamped before this column
-- exists resolves exactly as before, through the default credential. The old
-- code never selects the column, so a rolling deploy is safe both ways.
--
-- ON DELETE SET NULL rather than CASCADE: removing a mailbox must not delete
-- the correspondence that came through it. The thread keeps its history and
-- degrades to the default-credential behaviour, which is what it did before
-- this column existed.
--
-- No index. The only read is "the newest inbound message on THIS conversation
-- that names a credential", which the existing
-- `conversation_messages_conversation_chrono (conversation_id, …, seq)` already
-- serves; a thread holds few messages, so the `credential_id IS NOT NULL`
-- filter is resolved in memory.
ALTER TABLE app.conversation_messages
  ADD COLUMN IF NOT EXISTS credential_id text
    REFERENCES app.connector_credentials (id) ON DELETE SET NULL;
