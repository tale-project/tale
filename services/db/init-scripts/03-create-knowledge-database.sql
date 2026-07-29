-- Tale DB: the knowledge corpus database (`tale_knowledge`).
--
-- Creates the database, installs the extensions both corpora need, creates the
-- two schema namespaces, and grants the `tale` role access to them. NO tables
-- are declared here: every table and index lives in the dbmate migrations under
-- services/db/migrations/knowledge-db/<schema>/, which the container entrypoint
-- applies on start (TALE_DB_ROLE=knowledge). That split is deliberate — the
-- schema had drifted across three places once, and the corpus tables now have
-- exactly one declaration.
--
-- Idempotent: safe to run on every startup.

SELECT 'CREATE DATABASE tale_knowledge'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tale_knowledge')
\gexec

GRANT ALL PRIVILEGES ON DATABASE tale_knowledge TO tale;

\c tale_knowledge

-- pgvector holds the embeddings and is required.
CREATE EXTENSION IF NOT EXISTS "vector";

-- pg_search (ParadeDB) provides the BM25 index. It is OPTIONAL: a database
-- without it — any managed Postgres — still serves vector-only retrieval, and
-- the platform probes for the extension and degrades rather than erroring. So a
-- missing extension is a notice, never a failed startup.
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_search";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_search is not available; BM25 search will be disabled on this database: %', SQLERRM;
END; $$;

-- ============================================================================
-- The two corpora, as schema namespaces.
--   private_knowledge -> documents the organization uploaded
--   public_web        -> pages fetched from the web on its behalf
-- Both are created here so the grants below succeed before dbmate runs.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS public_web;
CREATE SCHEMA IF NOT EXISTS private_knowledge;

-- ============================================================================
-- Role + search_path
-- ============================================================================

ALTER ROLE tale IN DATABASE tale_knowledge SET search_path TO public_web, private_knowledge, public;

GRANT USAGE ON SCHEMA public_web TO tale;
GRANT USAGE ON SCHEMA private_knowledge TO tale;
GRANT ALL ON ALL TABLES IN SCHEMA public_web TO tale;
GRANT ALL ON ALL TABLES IN SCHEMA private_knowledge TO tale;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public_web TO tale;
GRANT ALL ON ALL SEQUENCES IN SCHEMA private_knowledge TO tale;

-- ALTER DEFAULT PRIVILEGES is an upsert, but two transactions racing on the
-- same (role, schema, object type) can both read "no row" from the syscache and
-- both INSERT, and the loser aborts on pg_default_acl's unique index. The
-- privileges are identical either way, so treat that collision as success
-- instead of failing a startup over it.
DO $$
BEGIN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public_web        GRANT ALL ON TABLES    TO tale;
    ALTER DEFAULT PRIVILEGES IN SCHEMA private_knowledge GRANT ALL ON TABLES    TO tale;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public_web        GRANT ALL ON SEQUENCES TO tale;
    ALTER DEFAULT PRIVILEGES IN SCHEMA private_knowledge GRANT ALL ON SEQUENCES TO tale;
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'pg_default_acl is already populated; skipping ALTER DEFAULT PRIVILEGES (% / %)', SQLSTATE, SQLERRM;
END;
$$;
