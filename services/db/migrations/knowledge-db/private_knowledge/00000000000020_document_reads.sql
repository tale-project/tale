-- migrate:up
--
-- A document's text as a read checked it, before the document's index holds
-- it.
--
-- A document attached in the app is read on a worker right after its upload:
-- its text extracted, then put through the organization's secret scan and
-- PII policy exactly as indexing does, so the assistant can read it while the
-- document's chunks are still being embedded. That text is extracted text,
-- and it lives where the index's text lives — here, in the organization's
-- knowledge database — never in the application database, which only records
-- where each read stands (`app.file_metadata.text_status`).
--
--   org_slug   the organization the file belongs to
--   file_id    the file's blob ref, as `documents.file_id` names it
--   content    the checked text: masked where the PII policy masks, never
--              the raw file's
--   read_at    when the read kept it
--
-- A row lives until the file's index is complete — the corpus serves the
-- text from then on — or until the file is released, whose purge removes it
-- with the file's corpus rows; a file that skips indexing keeps its row for
-- as long as the file itself. A newer read of the same file replaces it.
--
-- A new table: idempotent and rolling-safe — the previous image never reads
-- it.

CREATE TABLE IF NOT EXISTS private_knowledge.document_reads (
    org_slug  TEXT        NOT NULL,
    file_id   TEXT        NOT NULL,
    content   TEXT        NOT NULL,
    read_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_slug, file_id)
);

-- migrate:down
-- Deliberately empty, like the baseline.
