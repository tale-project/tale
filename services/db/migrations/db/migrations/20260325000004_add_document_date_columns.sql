-- migrate:up
ALTER TABLE private_knowledge.documents ADD COLUMN IF NOT EXISTS source_created_at TIMESTAMPTZ;
ALTER TABLE private_knowledge.documents ADD COLUMN IF NOT EXISTS source_modified_at TIMESTAMPTZ;

-- migrate:down
ALTER TABLE private_knowledge.documents DROP COLUMN IF EXISTS source_created_at;
ALTER TABLE private_knowledge.documents DROP COLUMN IF EXISTS source_modified_at;
