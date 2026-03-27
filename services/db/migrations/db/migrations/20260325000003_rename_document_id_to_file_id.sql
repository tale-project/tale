-- migrate:up
-- Rename document_id → file_id if the old column still exists.
-- On fresh databases the column is already file_id (created by init-scripts),
-- so this migration is a safe no-op.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'private_knowledge'
          AND table_name = 'documents'
          AND column_name = 'document_id'
    ) THEN
        ALTER TABLE private_knowledge.documents RENAME COLUMN document_id TO file_id;

        DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_unique_scope;
        DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_docid;

        CREATE UNIQUE INDEX idx_pk_docs_unique_scope
            ON private_knowledge.documents(file_id, COALESCE(team_id, ''), COALESCE(user_id, ''));
        CREATE INDEX idx_pk_docs_fileid
            ON private_knowledge.documents(file_id);
    END IF;
END;
$$;

-- migrate:down
-- Reversing a column rename is risky; intentionally left empty.
-- The application code expects file_id, so rolling back would break it.
