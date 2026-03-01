-- Tale DB: Core extensions and schema setup
-- Idempotent: safe to run on every startup

-- LEGACY CLEANUP (safe to remove once all environments are migrated):
-- Older ParadeDB images bundled TimescaleDB. After upgrading, the .so
-- is gone but its event triggers remain and block ALL DDL. We disable
-- them first (ALTER doesn't fire sql_drop, and the altered trigger is
-- already disabled before ddl_command_end fires), then drop safely.
DO $$
BEGIN
    BEGIN ALTER EVENT TRIGGER timescaledb_ddl_command_end DISABLE; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER EVENT TRIGGER timescaledb_ddl_sql_drop DISABLE; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN DROP EXTENSION IF EXISTS timescaledb CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$$;
DROP EVENT TRIGGER IF EXISTS timescaledb_ddl_command_end;
DROP EVENT TRIGGER IF EXISTS timescaledb_ddl_sql_drop;

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
