-- Where a document's read stands — the read that lets the assistant use a
-- document before the document's index exists.
--
-- A message that carried a document used to wait until the document was
-- indexed — extracted, then embedded chunk by chunk — so the organization's
-- embedding server decided whether a chat could be sent at all, and a backlog
-- of other uploads or a slow server held it for minutes. A document attached
-- in the app is now read on a worker right after its upload (`rag.read_file`):
-- the indexer's own extractors, then the organization's secret scan and PII
-- policy, exactly as indexing applies them. A message waits for that read,
-- never for the embedding server, and the assistant reads the checked text
-- through `rag_fetch` until the corpus holds the document. The read runs on a
-- worker and never in the api process, which runs the app's chat turns.
--
--   text_status
--       queued / running   the read is pending; a message carrying the file
--                          waits for it.
--       ready              the checked text is kept. The index run that
--                          completes the file drops it: the corpus serves the
--                          text from then on.
--       refused            the secret scan or the PII policy refused the text.
--       unreadable         the file holds no text, or does not open as its
--                          type.
--       deferred           too large to read before the index — over the
--                          byte cap, or more text than a read keeps — or the
--                          read itself failed: the index decides, and a
--                          message carrying the file waits for it.
--       NULL               never read this way: a file from before this
--                          migration, an image, a recording, a surface that
--                          skips indexing. Readers answer it as before.
--
--   text_error_code
--       why a read is not `ready`, in the indexer's vocabulary
--       (`rag_error_codes.ts`) where the indexer has a word for it —
--       `secret_detected`, `pii_blocked`, `pii_scan_failed`, `empty`,
--       `not_text`, `malformed`, `unsupported_type` — and `too_large`,
--       `too_much_text` or `read_failed` for a deferred read.
--
--   text_read_at_ms
--       when the current read was queued. A read still pending long after it
--       was queued has lost its job, and the read watchdog settles it
--       (`recoverStuckReads`); a verdict a transient fault caused is read
--       again only once it is this old by a short wait.
--
-- The checked text itself is not kept here. It is a document's extracted
-- text, which the organization's knowledge database holds, beside its index
-- (`private_knowledge.document_reads`): an organization that keeps its
-- knowledge in a database of its own keeps this text there too.
--
-- Rolling deploy: the previous image neither reads nor writes these columns.
-- Its uploads keep their NULL status and wait for their index, as they did.
-- The check is added NOT VALID: every existing row is NULL, and validating it
-- would scan the whole table while the previous image's file reads wait.

ALTER TABLE app.file_metadata
  ADD COLUMN IF NOT EXISTS text_status text,
  ADD COLUMN IF NOT EXISTS text_error_code text,
  ADD COLUMN IF NOT EXISTS text_read_at_ms bigint;

ALTER TABLE app.file_metadata
  DROP CONSTRAINT IF EXISTS file_metadata_text_status_check,
  ADD CONSTRAINT file_metadata_text_status_check CHECK (text_status IN (
    'queued', 'running', 'ready', 'refused', 'unreadable', 'deferred'
  )) NOT VALID;

-- The read watchdog's walk, every few minutes: only the pending reads, a
-- handful of rows at any time, oldest first.
CREATE INDEX IF NOT EXISTS file_metadata_pending_reads
  ON app.file_metadata (text_read_at_ms)
  WHERE text_status IN ('queued', 'running');
