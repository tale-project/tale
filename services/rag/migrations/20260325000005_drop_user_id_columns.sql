-- migrate:up
-- Remove unused user_id columns from private_knowledge tables.
-- user_id was never populated by any caller; all scoping uses file_id.

-- Drop indexes that reference user_id
DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_unique_scope;
DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_user;
DROP INDEX IF EXISTS private_knowledge.idx_pk_chunks_user;

-- Drop columns
ALTER TABLE private_knowledge.documents DROP COLUMN IF EXISTS user_id;
ALTER TABLE private_knowledge.chunks DROP COLUMN IF EXISTS user_id;

-- Recreate unique index without user_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_docs_unique_scope
    ON private_knowledge.documents(file_id, COALESCE(team_id, ''));

-- migrate:down
ALTER TABLE private_knowledge.documents ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE private_knowledge.chunks ADD COLUMN IF NOT EXISTS user_id TEXT;

DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_unique_scope;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_docs_unique_scope
    ON private_knowledge.documents(file_id, COALESCE(team_id, ''), COALESCE(user_id, ''));
CREATE INDEX IF NOT EXISTS idx_pk_docs_user
    ON private_knowledge.documents(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_chunks_user
    ON private_knowledge.chunks(user_id) WHERE user_id IS NOT NULL;
