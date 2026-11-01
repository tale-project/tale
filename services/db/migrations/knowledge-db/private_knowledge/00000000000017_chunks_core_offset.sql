-- migrate:up
--
-- Where a chunk starts in its document's text, stored when the chunk is
-- written. Until here every search hit computed it: a correlated subquery
-- per hit summed `length(core_content)` of every earlier chunk of the
-- document, so a hit deep inside a large document read the whole document
-- before it — once per hit, on every search.
--
--   core_offset  the character position of the chunk's `core_content` in
--                the document's text: the sum of `length(core_content)` of
--                the document's chunks with a lower `chunk_index`, the
--                value the subquery computes. The indexer writes it from
--                the previous chunk's row; NULL on a chunk written before
--                this release, for which the search still computes it
--
-- Chunks indexed before this release keep NULL and heal on their next
-- re-index, like `passage_repeat` (migration 12): a backfill here would
-- rewrite every chunk row and its index entries at container start.
-- ADD COLUMN without a default: metadata-only, idempotent, rolling-safe —
-- the previous image never writes the column and its rows read NULL.

ALTER TABLE private_knowledge.chunks
    ADD COLUMN IF NOT EXISTS core_offset BIGINT;

-- migrate:down
-- Deliberately empty, like the baseline.
