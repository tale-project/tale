-- migrate:up
-- Folder-scoped search filter (#662): denormalized Document Hub folder
-- path, written at ingestion from the upload `metadata` form field and
-- kept fresh via PATCH /api/v1/documents/folder-paths. Used by /search
-- as a boundary-safe hierarchical prefix filter inside the org-scoped
-- documents subquery.

ALTER TABLE private_knowledge.documents
  ADD COLUMN IF NOT EXISTS folder_path TEXT;

CREATE INDEX IF NOT EXISTS idx_pk_docs_org_folder
  ON private_knowledge.documents (org_slug, folder_path)
  WHERE folder_path IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_org_folder;

ALTER TABLE private_knowledge.documents
  DROP COLUMN IF EXISTS folder_path;
