-- migrate:up
-- Create semantic cache table for RAG query result caching.
-- Uses pgvector for cosine similarity lookups on query embeddings.

CREATE TABLE IF NOT EXISTS private_knowledge.semantic_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_text TEXT NOT NULL,
    query_embedding vector NOT NULL,
    response_text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    file_ids TEXT[] DEFAULT '{}'
);

-- HNSW index for fast cosine similarity lookups
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
    ON private_knowledge.semantic_cache
    USING hnsw (query_embedding vector_cosine_ops);

-- B-tree index for TTL cleanup
CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires_at
    ON private_knowledge.semantic_cache (expires_at);

-- GIN index for file-based invalidation
CREATE INDEX IF NOT EXISTS idx_semantic_cache_file_ids
    ON private_knowledge.semantic_cache USING gin (file_ids);

-- migrate:down
DROP TABLE IF EXISTS private_knowledge.semantic_cache;
