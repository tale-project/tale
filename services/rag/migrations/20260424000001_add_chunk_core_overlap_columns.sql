-- migrate:up
-- Part B Phase 1: add core_content / prefix_overlap / suffix_overlap columns
-- to private_knowledge.chunks. Populated going forward by the indexer
-- (dual-write alongside chunk_content). Existing rows start with the default
-- empty string and get backfilled via reindex.
--
-- Readers must fall back to chunk_content when core_content = '' until every
-- row has been reindexed (see services/rag/app/services/rag_service.py and
-- search_service.py).

ALTER TABLE private_knowledge.chunks
    ADD COLUMN IF NOT EXISTS core_content   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prefix_overlap TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suffix_overlap TEXT NOT NULL DEFAULT '';

-- migrate:down
ALTER TABLE private_knowledge.chunks
    DROP COLUMN IF EXISTS core_content,
    DROP COLUMN IF EXISTS prefix_overlap,
    DROP COLUMN IF EXISTS suffix_overlap;
