-- migrate:up
-- Track whether OCR was applied during document extraction.

ALTER TABLE private_knowledge.documents
  ADD COLUMN IF NOT EXISTS ocr_applied BOOLEAN NOT NULL DEFAULT FALSE;

-- migrate:down

ALTER TABLE private_knowledge.documents
  DROP COLUMN IF EXISTS ocr_applied;
