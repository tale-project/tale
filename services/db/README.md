# Tale PostgreSQL image

This image supplies PostgreSQL 16, ParadeDB full-text search and pgvector. Tale
runs it in two service roles: `db` stores application data and `knowledge-db`
stores the default retrieval corpus. Organization-specific knowledge connections
can point elsewhere; inspect the deployment configuration before diagnosing data.

## Understand database and migration ownership

| Database or schema | Owner |
| --- | --- |
| `tale_app` | Platform backend; numbered SQL migrations under `services/platform/backend/db/migrations/` |
| `tale_knowledge` | Knowledge migration sets under `migrations/knowledge-db/` |
| Databases, extensions and grants | Idempotent infrastructure scripts under `init-scripts/` |
| pg-boss and authentication tables | Their backend startup migrations |

`TALE_DB_ROLE=platform` selects the application service's currently empty dbmate
set. `TALE_DB_ROLE=knowledge` selects the knowledge schemas and is the image's
default. Both roles use the same image; the role determines the migration set.
Do not put application-table changes into database initialization scripts.

## Configure a container

The image listens on PostgreSQL port `5432`. `DB_NAME` and `DB_USER` default to
`tale`; `DB_PASSWORD` (or `POSTGRES_PASSWORD`) is required. `tale` is the bootstrap
database, while application queries target `tale_app`.

The entrypoint maps connection, memory and logging variables to PostgreSQL
settings. Read [`docker-entrypoint.sh`](docker-entrypoint.sh) for supported
`DB_*` values and [`postgresql.conf`](postgresql.conf) for the static defaults.
Keep database passwords in the deployment's secret environment.

## Wait for initialization

The healthcheck requires both `pg_isready` and `/tmp/.db_ready`. The marker is
written after initialization and the selected migrations finish. Checking only
`pg_isready` can mistake the temporary bootstrap server for the final server.

For a Compose deployment, inspect health and logs before starting dependent work:

```bash
docker compose ps db knowledge-db
docker compose logs --tail=100 db knowledge-db
```

Run these commands from the directory containing the deployment's Compose files.
For an application SQL session, select the application database explicitly:

```bash
docker compose exec db psql -U tale -d tale_app
```

Use the configured user if it differs. The workspace's `shell` helper opens the
bootstrap `tale` database; it does not automatically select `tale_app`.

## Build and maintain the image

From the repository root:

```bash
bun run --filter @tale/db docker:build
bun run --filter @tale/db logs
```

The [backup and restore guide](../../docs/en/self-hosted/operate/backups-and-restore.md)
covers application data, knowledge data, files, configuration and secrets as one
recovery plan. Preserve existing data during upgrades; stopping or replacing a
container is different from deleting its volume.
