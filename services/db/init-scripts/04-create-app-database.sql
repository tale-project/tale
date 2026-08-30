-- Tale DB: 0.5 application database (Hono API + Graphile Worker on Postgres)
-- Owned by the platform image's `api`/`worker` roles (services/platform/backend).
-- Idempotent: safe to run on every startup

SELECT 'CREATE DATABASE tale_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tale_app')
\gexec

GRANT ALL PRIVILEGES ON DATABASE tale_app TO tale;
