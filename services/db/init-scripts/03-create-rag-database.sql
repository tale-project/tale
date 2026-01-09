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

-- Log completion
\echo 'RAG database created successfully: tale_rag'
