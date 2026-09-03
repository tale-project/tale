# @tale/db

PostgreSQL 16 with [ParadeDB](https://www.paradedb.com/) (`pg_search` BM25 + `pgvector`).

## Overview

The shared datastore for every Tale service. Init scripts in `init-scripts/` create the databases and extensions on first boot:

- `tale_app` — the 0.5 platform application database (the Hono API + pg-boss workers in `services/platform/backend`). Its schema is owned by that backend, which applies its own numbered `.sql` migrations at boot; nothing here migrates it.
- `tale_knowledge` — the knowledge corpus (RAG + crawler), queried in-process by the platform backend
- `tale_platform` — the legacy Convex database, still created for backward compatibility but unused by the 0.5 backend

`migrations/` holds the dbmate migration sets, grouped by container role and applied on startup by `docker-entrypoint.sh` per the `TALE_DB_ROLE` env var (set per-service in `compose.yml`):

- `migrations/knowledge-db/` — the `tale_knowledge` corpus, one subdirectory per schema (`private_knowledge/`, `public_web/`), each with its own schema-scoped tracking table. Applied when `TALE_DB_ROLE=knowledge`.
- `migrations/db/` — the `db` service's platform role. Empty and a no-op: the 0.5 app database (`tale_app`) is migrated by the platform backend at boot (numbered `.sql`), not by dbmate. Applied when `TALE_DB_ROLE=platform`.

The same image backs both the `db` (`TALE_DB_ROLE=platform`) and `knowledge-db` (`TALE_DB_ROLE=knowledge`) services, so the role — not the image — decides which set runs. Shared infrastructure (databases, extensions, schema namespaces, grants) stays in `init-scripts/`; never put table DDL there. The image is built on ParadeDB's PG16 base with debug symbols, PostGIS, LLVM, and extra locales stripped.

## Interface

Ports:

- `5432` — PostgreSQL

Healthcheck runs `pg_isready` plus a `/tmp/.db_ready` marker written after init scripts finish (so the platform backend doesn't connect mid-bootstrap; see PR #1633).

## Configuration

Tunables come from `DB_*` environment variables (mapped to PostgreSQL settings by `docker-entrypoint.sh`):

- `DB_NAME`, `DB_USER`, `DB_PASSWORD` (required)
- `DB_MAX_CONNECTIONS`, `DB_SHARED_BUFFERS`, `DB_EFFECTIVE_CACHE_SIZE`, `DB_MAINTENANCE_WORK_MEM`, `DB_WORK_MEM`
- `DB_LOG_STATEMENT`, `DB_LOG_MIN_DURATION_STATEMENT`

`postgresql.conf` provides the static base configuration.

## Development

```bash
bun run logs  --filter=@tale/db        # docker compose logs -f db
bun run shell --filter=@tale/db        # psql into the running container
```

## Layout

- `Dockerfile` — multi-stage build on ParadeDB PG16
- `docker-entrypoint.sh` — maps `DB_*` vars onto PostgreSQL CLI flags, then invokes upstream entrypoint
- `init-scripts/` — first-boot SQL (extensions, databases, grants)
- `migrations/` — dbmate migration sets grouped by role: `knowledge-db/{private_knowledge,public_web}/` (the `tale_knowledge` corpus) and `db/` (empty — the `tale_app` schema is migrated by the platform backend at boot, not dbmate). Applied per `TALE_DB_ROLE` by `docker-entrypoint.sh`
- `postgresql.conf` — base PostgreSQL configuration
