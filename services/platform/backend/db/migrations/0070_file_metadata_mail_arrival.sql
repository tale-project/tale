-- 0.5 app migration 0070: the mail-arrival index on file rows.
--
-- `app.file_metadata` holds every stored file. Only the rows the email binder
-- bound to a conversation carry `mail_received_at_ms`, so a partial index over
-- its non-null values IS the mail index — and it is a tiny slice of the table
-- (on one deployment, 3 rows of 3,671 carried a conversation).
--
-- The chat assistant's `list kind="mail-attachment"` leg answers in ARRIVAL
-- order, newest first. The only existing index on the pair
-- (`file_metadata_conversation`, from migration 0037) leads with
-- `conversation_id`, so it orders by conversation — the shape PR #3035
-- recorded as REJECTED, because a by-arrival page then reads most of its
-- budget to return one row, and above the budget reports "most recent" from an
-- arbitrary window.
--
-- `id` is in the index so the walk's tiebreak inside one millisecond is
-- index-ordered too: which rows a bounded listing keeps is part of its answer,
-- not an implementation detail.

CREATE INDEX IF NOT EXISTS file_metadata_mail_arrival
  ON app.file_metadata (org_id, mail_received_at_ms DESC, id DESC)
  WHERE mail_received_at_ms IS NOT NULL;
