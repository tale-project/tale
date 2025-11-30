# Tale DB (TimescaleDB/PostgreSQL)

PostgreSQL with TimescaleDB extension, configured via DB\_\* environment variables and a wrapper entrypoint. Includes initialization scripts for Timescale/UUID/trgm and a separate database for Convex self-hosted.

## Ports

- 5432 (Postgres)

## Credentials and Defaults

Set in .env (the entrypoint maps DB\_\* to standard Postgres vars):

```
DB_NAME=tale
DB_USER=tale
DB_PASSWORD=change_me
```

These map to POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD at runtime.

## Initialization

The following scripts run on first startup:

- init-scripts/01-init-timescaledb.sql
  - enables extensions: timescaledb, uuid-ossp, pg_stat_statements, pgcrypto
  - creates schema tale and time-series tables tale.metrics and tale.events, hypertables and indexes
- init-scripts/02-create-convex-database.sql
  - creates tale_platform database for Convex self-hosted

## Connecting

Local psql:

```
psql postgresql://tale:change_me@localhost:5432/tale
```

Inside container:

```
docker exec -it tale-db psql -U tale -d tale
```

Health:

```
docker exec tale-db pg_isready -U tale -d tale
```

## Tuning (env)

Prefix: DB\_

- MAX_CONNECTIONS
- SHARED_BUFFERS, EFFECTIVE_CACHE_SIZE, MAINTENANCE_WORK_MEM, WORK_MEM
- TIMESCALEDB_TELEMETRY (off recommended)
- LOG_STATEMENT, LOG_MIN_DURATION_STATEMENT

See docker-entrypoint-wrapper.sh and postgresql.conf for details.

## Data Persistence

- db-data volume is mounted to /home/postgres/pgdata/data
- db-backup volume available for backups

## Notes

- Change the default password for any real environment
- Timescale hypertables exist as examples; adjust to your data model
