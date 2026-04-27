# @tale/db

PostgreSQL 16 with [ParadeDB](https://www.paradedb.com/) (`pg_search` BM25 + `pgvector`).

## Overview

The shared datastore for every Tale service. Init scripts in `init-scripts/` create the databases and extensions on first boot:

- `tale_platform` — owned by Convex
- `tale_knowledge` — owned by `rag` and `crawler`

Each service owns its own schema and runs its own dbmate migrations on startup; **do not** add service-specific tables here. The image is built on ParadeDB's PG16 base with debug symbols, PostGIS, LLVM, and extra locales stripped.

## Interface

Ports:

- `5432` — PostgreSQL

Healthcheck runs `pg_isready` plus a `/tmp/.db_ready` marker written after init scripts finish (so Convex doesn't connect mid-bootstrap; see PR #1633).

## Configuration

Tunables come from `DB_*` environment variables (mapped to PostgreSQL settings by `docker-entrypoint-wrapper.sh`):

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
- `docker-entrypoint-wrapper.sh` — maps `DB_*` vars onto PostgreSQL CLI flags, then invokes upstream entrypoint
- `init-scripts/` — first-boot SQL (extensions, databases, grants)
- `postgresql.conf` — base PostgreSQL configuration
