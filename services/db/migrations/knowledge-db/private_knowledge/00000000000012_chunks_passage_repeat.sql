-- migrate:up
--
-- A chunk whose text repeats an earlier chunk of the same document is a
-- REPEAT: stored, so the document reassembles exactly from `core_content`,
-- but embedded and searched once, through its first occurrence. Until here
-- every chunk was embedded and indexed on its own: an 8 MiB export of one
-- repeated line became 4,500 identical vectors in the one HNSW index every
-- organization's rows share, where they crowded out strictly nearer
-- passages, and 24 copies of one line in the keyword leg (2026-09-14
-- evaluation, h4).
--
--   passage_repeat  true on a chunk whose `content_hash` an earlier
--                   `chunk_index` of the same document carries; such a row
--                   has no embedding and both search legs skip it
--
-- Documents indexed before this release keep their rows as they are (the
-- flag defaults to false) and heal on their next re-index — the content hash
-- is unchanged, so an explicit `retry-indexing` is what re-embeds them.
-- ADD COLUMN with a default: metadata-only, idempotent, rolling-safe — the
-- previous image never writes the column and its rows read `false`.

ALTER TABLE private_knowledge.chunks
    ADD COLUMN IF NOT EXISTS passage_repeat BOOLEAN NOT NULL DEFAULT FALSE;

-- migrate:down
-- Deliberately empty, like the baseline.
