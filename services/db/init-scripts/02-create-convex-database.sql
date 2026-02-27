-- Tale DB: Convex self-hosted database
-- Idempotent: safe to run on every startup

SELECT 'CREATE DATABASE tale_platform'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tale_platform')
\gexec

GRANT ALL PRIVILEGES ON DATABASE tale_platform TO tale;

\c tale_platform

DROP EXTENSION IF EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
