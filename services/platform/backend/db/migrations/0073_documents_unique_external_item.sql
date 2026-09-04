-- 0.5 app migration 0073: one document per (org, external item) — the
-- idempotency key the agent `document_create` tool, the project-text panel
-- files, and the OneDrive / Google Drive sync engine all upsert on.
--
-- Why: every upsert lane was SELECT … FOR UPDATE then INSERT over a PLAIN
-- index (0011 `documents_org_external`). FOR UPDATE over zero rows locks
-- nothing, so two concurrent runs both missed and both inserted — and every
-- later refresh updated only the OLDEST row (each lane reads ORDER BY
-- created_at_ms ASC), so the duplicate lingered in listings and in RAG
-- forever. The rule the lanes assumed becomes the schema's: a partial
-- unique index the database cannot forget, and the lanes insert with
-- ON CONFLICT so the loser of a race refreshes the winner's row.
--
-- Existing duplicates: the oldest row per key is the one every refresh has
-- been landing on, so it keeps the key. Newer duplicates are DETACHED from
-- the key, never deleted — a document is the user's content. The key they
-- carried is kept in `metadata.dedupedExternalItemId`, so an operator can
-- find the strays and trash them deliberately.
--
-- Rolling-deploy safe: the previous image keeps working — its check-then-
-- insert only ever races itself, and the winner of that race is now the
-- database's answer rather than a second row.

WITH ranked AS (
  SELECT id, external_item_id,
         row_number() OVER (
           PARTITION BY org_id, external_item_id
           ORDER BY created_at_ms ASC, id ASC
         ) AS rn
  FROM app.documents
  WHERE external_item_id IS NOT NULL
)
UPDATE app.documents d SET
  external_item_id = NULL,
  metadata = coalesce(d.metadata, '{}'::jsonb)
             || jsonb_build_object('dedupedExternalItemId', ranked.external_item_id)
FROM ranked
WHERE d.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS documents_org_external_unique
  ON app.documents (org_id, external_item_id)
  WHERE external_item_id IS NOT NULL;

-- The plain index is now a strict subset of the unique one for every lookup
-- the lanes issue (`org_id = $1 AND external_item_id = $2`).
DROP INDEX IF EXISTS app.documents_org_external;
