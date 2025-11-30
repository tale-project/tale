-- ============================================================================
-- Create Convex Self-Hosted Database
-- ============================================================================
-- This script creates the database required by Convex self-hosted backend.
-- The database name is specified by CONVEX_INSTANCE_NAME environment variable.
-- Default: tale_platform
-- ============================================================================

-- Set default database name if not provided
\set convex_db_name `echo ${CONVEX_INSTANCE_NAME:-tale_platform}`

-- Create the Convex database
CREATE DATABASE :convex_db_name;

-- Grant privileges to the tale user
GRANT ALL PRIVILEGES ON DATABASE :convex_db_name TO tale;

-- Connect to the new database
\c :convex_db_name

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Log completion
\echo 'Convex database created successfully: ' :convex_db_name

