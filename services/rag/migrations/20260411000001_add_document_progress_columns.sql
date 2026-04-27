-- migrate:up
-- Add progress tracking columns for document indexing status.

ALTER TABLE private_knowledge.documents
  ADD COLUMN IF NOT EXISTS progress_phase TEXT,
  ADD COLUMN IF NOT EXISTS progress_detail TEXT;

-- migrate:down

ALTER TABLE private_knowledge.documents
  DROP COLUMN IF EXISTS progress_phase,
  DROP COLUMN IF EXISTS progress_detail;
