-- migrate:up
-- Metadata pre-filtering (#1517): flat document-level metadata bag
-- (department, year, document_type, …) written at ingestion from the
-- upload `metadata` form field and kept fresh via
-- PATCH /api/v1/documents/metadata. /search folds `filters.metadata`
-- into the org-scoped documents subquery so non-matching documents are
-- excluded BEFORE ranking. jsonb_path_ops GIN serves the `@>`
-- containment used for scalar equality filters; IN-list filters run
-- un-indexed inside the already org/file_ids-bounded subquery.

ALTER TABLE private_knowledge.documents
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_pk_docs_metadata
  ON private_knowledge.documents USING gin (metadata jsonb_path_ops);

-- migrate:down

DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_metadata;

ALTER TABLE private_knowledge.documents
  DROP COLUMN IF EXISTS metadata;
