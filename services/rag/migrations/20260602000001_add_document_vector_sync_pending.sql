-- migrate:up
-- Marks documents whose chunk vectors are not yet mirrored into the external
-- vector backend (e.g. Qdrant) — set when a live mirror sync fails so the doc
-- stays 'completed' (it is correctly indexed in Postgres, the source of truth)
-- while a background reconcile re-publishes its vectors. A partial index keeps
-- the reconcile scan cheap when nothing is pending.

ALTER TABLE private_knowledge.documents
  ADD COLUMN IF NOT EXISTS vector_sync_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_pk_docs_vector_sync_pending
  ON private_knowledge.documents(org_slug)
  WHERE vector_sync_pending;

-- migrate:down

DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_vector_sync_pending;

ALTER TABLE private_knowledge.documents
  DROP COLUMN IF EXISTS vector_sync_pending;
