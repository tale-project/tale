-- Move a knowledge entry's content hash from metadata.contentHash into the
-- content_hash column.
--
-- Every document a knowledge entry materialized carried the SHA-256 of its
-- markdown as `metadata->>'contentHash'` — write-only bookkeeping in the
-- caller-owned `metadata` bag, which a `PATCH /api/v1/documents/{id}` that
-- replaced the bag silently dropped, while the `content_hash` COLUMN the rest
-- of the platform reads (the WebDAV ETag, change detection, the REST
-- `contentHash`) stayed NULL for those rows. The entry service now writes the
-- column and never touches `metadata`; this moves what the old code left
-- behind: the column takes the bag's value where it has none, and the key
-- leaves the bag (an emptied bag reads as NULL, the way a document created
-- without metadata does).
--
-- Set-based and idempotent: only `knowledge` documents that still carry the
-- key are touched, and a second run finds none. Rolling-deploy safe: the
-- previous image reads neither field on this path, and the column already
-- exists (0011).

UPDATE app.documents
SET content_hash = coalesce(content_hash, metadata->>'contentHash'),
    metadata = nullif(metadata - 'contentHash', '{}'::jsonb)
WHERE source_provider = 'knowledge'
  AND metadata ? 'contentHash';
