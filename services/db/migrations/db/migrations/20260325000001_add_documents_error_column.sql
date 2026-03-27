-- migrate:up
ALTER TABLE private_knowledge.documents ADD COLUMN IF NOT EXISTS error TEXT;

-- migrate:down
ALTER TABLE private_knowledge.documents DROP COLUMN IF EXISTS error;
