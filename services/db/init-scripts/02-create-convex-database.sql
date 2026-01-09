-- ============================================================================
-- Create Convex Self-Hosted Database
-- ============================================================================
-- This script creates the database required by Convex self-hosted backend.
-- The database name is HARDCODED to tale_platform for safety and consistency.
-- ============================================================================

-- Create the Convex database (hardcoded name)
CREATE DATABASE tale_platform;

-- Grant privileges to the tale user
GRANT ALL PRIVILEGES ON DATABASE tale_platform TO tale;

-- Connect to the new database
\c tale_platform

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Log completion
\echo 'Convex database created successfully: tale_platform'

