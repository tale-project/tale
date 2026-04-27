-- ============================================================================
-- OPTIONAL cleanup for the migration-ownership refactor (Part A).
--
-- Context: before this refactor, dbmate ran centrally from the DB container
-- and wrote its tracking rows to `schema_migrations` WITHOUT a schema prefix.
-- Role `tale` in `tale_knowledge` has `search_path` set to
-- `public_web, private_knowledge, public` at the database level (see
-- services/db/init-scripts/03-create-knowledge-database.sql), so the
-- unprefixed CREATE TABLE landed in `public_web.schema_migrations` —
-- which, after the refactor, also happens to be crawler's new tracking
-- table. The legacy rows (8 RAG-owned versions) coexist with crawler's
-- baseline row there and are harmless: crawler dbmate only checks whether
-- its own baseline version is present.
--
-- After the refactor each service runs its own dbmate with a schema-scoped
-- tracking table — private_knowledge.schema_migrations (RAG) and
-- public_web.schema_migrations (crawler).
--
-- IS THIS SCRIPT REQUIRED?  No. Every existing RAG migration is idempotent
-- (CREATE … IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DO blocks guarded by
-- existence checks), so the per-service dbmate will safely re-apply them as
-- no-ops on the first post-refactor boot and then mark them applied. Zero
-- manual intervention is needed; just rebuild images and restart services.
--
-- WHEN TO RUN IT: If you want to skip the first-boot "apply 8 no-op
-- migrations" log noise for RAG, run this once per environment. It copies
-- the applied RAG versions from `public_web.schema_migrations` (where the
-- old centralized dbmate wrote them) into `private_knowledge.schema_migrations`
-- and seeds both service baselines.
--
-- Safe to run repeatedly (ON CONFLICT DO NOTHING), safe on fresh deployments
-- (becomes a no-op — nothing to copy), and safe on deployments that already
-- crossed the refactor (per-service tables already hold their versions).
-- This script is NON-DESTRUCTIVE: it never DROPs or DELETEs.
--
--   psql "postgresql://<user>:<pw>@<host>/tale_knowledge" \
--        -f scripts/bootstrap_migration_split.sql
-- ============================================================================

\c tale_knowledge

-- Ensure destination tracking tables exist. (dbmate creates them on first
-- run too, but doing it here lets the script work before either service
-- has started.)

CREATE SCHEMA IF NOT EXISTS private_knowledge;
CREATE TABLE IF NOT EXISTS private_knowledge.schema_migrations (
    version VARCHAR(255) PRIMARY KEY
);

CREATE SCHEMA IF NOT EXISTS public_web;
CREATE TABLE IF NOT EXISTS public_web.schema_migrations (
    version VARCHAR(255) PRIMARY KEY
);

-- Mark both per-service baselines as applied.
INSERT INTO private_knowledge.schema_migrations (version) VALUES ('00000000000000')
ON CONFLICT DO NOTHING;
INSERT INTO public_web.schema_migrations (version) VALUES ('00000000000000')
ON CONFLICT DO NOTHING;

-- Copy every non-baseline version from public_web.schema_migrations (where
-- the centralized dbmate left them) into private_knowledge.schema_migrations.
-- All current incremental migrations touch private_knowledge.*, so they all
-- belong to RAG. Fresh deployments: this SELECT returns zero rows (the only
-- entry is the baseline we just seeded).
INSERT INTO private_knowledge.schema_migrations (version)
SELECT version FROM public_web.schema_migrations
WHERE version <> '00000000000000'
ON CONFLICT DO NOTHING;
