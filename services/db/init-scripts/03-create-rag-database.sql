-- ============================================================================
-- Create RAG (Cognee) Database
-- ============================================================================
-- This script creates the database required by the RAG service (Cognee).
-- The database is dedicated to RAG to allow safe full-database resets without
-- affecting other services (e.g., Convex uses tale_platform).
-- ============================================================================

-- Create the RAG database (hardcoded name for safety)
CREATE DATABASE tale_rag;

-- Grant privileges to the tale user
GRANT ALL PRIVILEGES ON DATABASE tale_rag TO tale;

-- Connect to the new database
\c tale_rag

-- Enable required extensions for Cognee/PGVector
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- HNSW Index Management for PGVector
-- ============================================================================
-- Cognee creates vector tables dynamically (one per collection/dataset).
-- This function creates HNSW indexes on vector columns for fast similarity search.
-- Without indexes, queries on 200k+ vectors can take 5-15 seconds.
-- With HNSW indexes, queries complete in <500ms.
-- ============================================================================

-- Function to create HNSW indexes on all vector columns that don't have one
CREATE OR REPLACE FUNCTION create_vector_hnsw_indexes()
RETURNS void AS $$
DECLARE
    rec RECORD;
    index_name TEXT;
    index_exists BOOLEAN;
BEGIN
    -- Find all columns with vector type in public schema
    FOR rec IN
        SELECT
            c.table_name,
            c.column_name,
            c.udt_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
            ON c.table_name = t.table_name
            AND c.table_schema = t.table_schema
        WHERE c.table_schema = 'public'
            AND c.udt_name = 'vector'
            AND t.table_type = 'BASE TABLE'
    LOOP
        -- Generate index name
        index_name := rec.table_name || '_' || rec.column_name || '_hnsw_idx';

        -- Check if index already exists
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
                AND indexname = index_name
        ) INTO index_exists;

        -- Create index if it doesn't exist
        IF NOT index_exists THEN
            RAISE NOTICE 'Creating HNSW index: % on %.%',
                index_name, rec.table_name, rec.column_name;

            -- Use cosine distance operator (most common for embeddings)
            -- m=16, ef_construction=64 are good defaults for quality/speed balance
            EXECUTE format(
                'CREATE INDEX %I ON %I USING hnsw (%I vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                index_name,
                rec.table_name,
                rec.column_name
            );

            RAISE NOTICE 'Created HNSW index: %', index_name;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Log completion
\echo 'RAG database created successfully: tale_rag'
\echo 'HNSW index function created: SELECT create_vector_hnsw_indexes();'
