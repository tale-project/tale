-- 0.5 app migration 0037: conversation attachment binding on file rows —
-- the 0.4 `fileMetadata.conversationId`/`mailReceivedAt` pair: a stored mail
-- attachment points at the conversation it arrived on (the Inbox lists and
-- serves it by that pointer), and the mail's own receive time indexes the
-- attachment chronology.

ALTER TABLE app.file_metadata
  ADD COLUMN conversation_id text,
  ADD COLUMN mail_received_at_ms bigint;

CREATE INDEX file_metadata_conversation
  ON app.file_metadata (conversation_id, mail_received_at_ms);

-- The connector-operation approval lifecycle adds the `executing` state
-- (human approved, not yet consumed by the gate) plus the chat-card anchors
-- and the consume stamp the 0.4 rows carried.
ALTER TABLE app.approvals
  DROP CONSTRAINT approvals_status_check,
  ADD CONSTRAINT approvals_status_check CHECK (status IN (
    'pending', 'executing', 'completed', 'rejected'
  )),
  ADD COLUMN thread_id text,
  ADD COLUMN message_id text,
  ADD COLUMN executed_at_ms bigint;
