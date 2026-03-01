-- Tale DB: Convex self-hosted database
-- Idempotent: safe to run on every startup

SELECT 'CREATE DATABASE tale_platform'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tale_platform')
\gexec

GRANT ALL PRIVILEGES ON DATABASE tale_platform TO tale;

\c tale_platform

-- LEGACY CLEANUP (safe to remove once all environments are migrated, see 01-init-extensions.sql).
DO $$
BEGIN
    BEGIN ALTER EVENT TRIGGER timescaledb_ddl_command_end DISABLE; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER EVENT TRIGGER timescaledb_ddl_sql_drop DISABLE; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN DROP EXTENSION IF EXISTS timescaledb CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$$;
DROP EVENT TRIGGER IF EXISTS timescaledb_ddl_command_end;
DROP EVENT TRIGGER IF EXISTS timescaledb_ddl_sql_drop;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
