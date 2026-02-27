-- Tale DB: Core extensions and schema setup
-- Idempotent: safe to run on every startup

-- Remove legacy TimescaleDB extension if present
DROP EXTENSION IF EXISTS timescaledb CASCADE;

-- Enable core extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create tale schema
CREATE SCHEMA IF NOT EXISTS tale;

-- Set search path
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO tale, public', current_database());
END $$;

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA tale TO CURRENT_USER;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA tale TO CURRENT_USER;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA tale TO CURRENT_USER;
