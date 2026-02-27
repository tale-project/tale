-- Tale DB: RAG (Cognee) database
-- Idempotent: safe to run on every startup

SELECT 'CREATE DATABASE tale_rag'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tale_rag')
\gexec

GRANT ALL PRIVILEGES ON DATABASE tale_rag TO tale;

\c tale_rag

DROP EXTENSION IF EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Dynamic HNSW index creation for Cognee's vector tables
CREATE OR REPLACE FUNCTION create_vector_hnsw_indexes()
RETURNS void AS $$
DECLARE
    rec RECORD;
    index_name TEXT;
    index_exists BOOLEAN;
BEGIN
    FOR rec IN
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
            ON c.table_name = t.table_name AND c.table_schema = t.table_schema
        WHERE c.table_schema = 'public'
            AND c.udt_name = 'vector'
            AND t.table_type = 'BASE TABLE'
    LOOP
        index_name := rec.table_name || '_' || rec.column_name || '_hnsw_idx';

        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = index_name
        ) INTO index_exists;

        IF NOT index_exists THEN
            EXECUTE format(
                'CREATE INDEX %I ON %I USING hnsw (%I vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                index_name, rec.table_name, rec.column_name
            );
            RAISE NOTICE 'Created HNSW index: %', index_name;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
