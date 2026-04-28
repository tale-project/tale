-- Tale DB: Unified knowledge database (crawler + RAG)
-- Creates the `tale_knowledge` database, installs required extensions, creates
-- the two schema namespaces (`public_web` for crawler, `private_knowledge` for
-- RAG), and grants the tale role access. Table/index DDL lives in each
-- service's own migrations (services/rag/migrations/, services/crawler/migrations/)
-- and runs at that service's container startup via dbmate.
-- Idempotent: safe to run on every startup.

SELECT 'CREATE DATABASE tale_knowledge'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tale_knowledge')
\gexec

GRANT ALL PRIVILEGES ON DATABASE tale_knowledge TO tale;

\c tale_knowledge

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

-- Extensions (database-level, shared by both schemas)
CREATE EXTENSION IF NOT EXISTS "vector";
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_search";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_search extension not available, BM25 search will be disabled: %', SQLERRM;
END; $$;

-- ============================================================================
-- Schema namespaces
-- Each service owns its tables via its own dbmate migrations:
--   - public_web        → services/crawler/migrations/
--   - private_knowledge → services/rag/migrations/
-- Create the namespaces here so grants below succeed before any service runs.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS public_web;
CREATE SCHEMA IF NOT EXISTS private_knowledge;


-- ============================================================================
-- Roles + search_path
-- ============================================================================

ALTER ROLE tale IN DATABASE tale_knowledge SET search_path TO public_web, private_knowledge, public;

GRANT USAGE ON SCHEMA public_web TO tale;
GRANT USAGE ON SCHEMA private_knowledge TO tale;
GRANT ALL ON ALL TABLES IN SCHEMA public_web TO tale;
GRANT ALL ON ALL TABLES IN SCHEMA private_knowledge TO tale;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public_web TO tale;
GRANT ALL ON ALL SEQUENCES IN SCHEMA private_knowledge TO tale;
-- Wrap in a DO/EXCEPTION block so concurrent or repeated invocations don't
-- abort the script with a unique_violation on pg_default_acl. SetDefaultACL
-- is an UPSERT, but two transactions racing on the same (role, schema,
-- objtype) can both see "no row" via syscache and both INSERT — the second
-- then fails on pg_default_acl_role_nsp_obj_index. Treat that as success.
DO $$
BEGIN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public_web        GRANT ALL ON TABLES    TO tale;
    ALTER DEFAULT PRIVILEGES IN SCHEMA private_knowledge GRANT ALL ON TABLES    TO tale;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public_web        GRANT ALL ON SEQUENCES TO tale;
    ALTER DEFAULT PRIVILEGES IN SCHEMA private_knowledge GRANT ALL ON SEQUENCES TO tale;
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'pg_default_acl already populated, skipping ALTER DEFAULT PRIVILEGES';
END;
$$;
