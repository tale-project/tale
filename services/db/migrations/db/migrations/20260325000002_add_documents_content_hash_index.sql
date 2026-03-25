-- migrate:up
CREATE INDEX IF NOT EXISTS idx_pk_docs_content_hash
    ON private_knowledge.documents(content_hash)
    WHERE content_hash IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS private_knowledge.idx_pk_docs_content_hash;
