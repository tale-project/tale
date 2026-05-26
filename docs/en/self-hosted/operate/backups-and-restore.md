---
title: Backups and restore
description: Postgres backups via the `db-backup` volume, what else to capture, and the restore-from-dump drill.
---

The Postgres volume `db-data` is the only stateful piece in a Tale instance that matters for backups. Everything else — Convex code, agent definitions, uploaded files referenced by the database — is either re-derivable from the source repo or held under `convex-data`, which is mostly a cache. A working backup story captures Postgres plus the `providers/` directory and the operator config under `TALE_CONFIG_DIR`. This page is the drill.

The architecture context lives in [Container architecture](/self-hosted/operate/container-architecture); this page covers the actual snapshot, off-site copy, and restore walk.

## What to back up

| Path                  | Source                     | Why                                             |
| --------------------- | -------------------------- | ----------------------------------------------- |
| `db-data` volume      | Postgres data              | The whole database — agents, runs, audit, files |
| `db-backup` volume    | Postgres dumps             | Where the scheduled dump writes                 |
| `providers/`          | Provider keys + config     | Encrypted secrets and per-provider model lists  |
| `${TALE_CONFIG_DIR}/` | Branding, retention bounds | Operator-set config files                       |
| `.env`                | All env vars               | Required to redeploy on a fresh host            |

The two volumes are managed by docker; the `providers/` directory and `TALE_CONFIG_DIR` are mounted into the platform container from your host filesystem. Backup tooling that snapshots host disks captures all three at once; volume-aware tools (`restic`, `velero`) need both.

## Scheduled Postgres dumps

The `tale-db` container ships a cron job that writes a daily `pg_dump` to `/var/lib/postgresql/backup` — mounted as the `db-backup` volume. The default retention is seven days; older dumps are pruned. The schedule is fine for most teams; tighten it by editing the container's crontab or running a sidecar.

```bash
# Inspect the dumps the container has produced
docker compose exec db ls -lh /var/lib/postgresql/backup
```

Each dump is a compressed SQL file named `tale-YYYYMMDD-HHMMSS.sql.gz`. They are intentionally not encrypted at rest — encrypt them with your existing backup tooling on the way off-host.

## Off-host copy

The supported pattern is your existing snapshot tooling (Restic, Borg, Velero, cloud-provider snapshots) pointed at the host disk or the named volumes. Tale does not ship an upload step — keeping the off-host copy under your existing backup contract is deliberate.

A minimal Restic example writing the dump volume to S3 once an hour:

```bash
# crontab on the host
0 * * * * restic -r s3:s3.amazonaws.com/bucket/tale backup \
  /var/lib/docker/volumes/tale_db-backup/_data
```

Capture `providers/`, `${TALE_CONFIG_DIR}`, and `.env` in the same job. The first restore drill will tell you whether the snapshot covers what you needed.

## Restoring from a dump

The restore replaces the entire database. Bring the platform and convex containers down first, restore Postgres in isolation, then bring everything back up.

```bash
# 1. Stop everything that writes to the DB
docker compose stop tale-platform tale-convex

# 2. Drop the existing DB and re-create it empty
docker compose exec db psql -U tale -c "DROP DATABASE tale;"
docker compose exec db psql -U tale -c "CREATE DATABASE tale;"

# 3. Pipe the dump back in
docker compose exec -T db gunzip -c \
  /var/lib/postgresql/backup/tale-20250126-020000.sql.gz \
  | docker compose exec -T db psql -U tale -d tale

# 4. Bring the rest back up
docker compose up -d
```

The first request after restart re-warms the platform's caches; expect the UI to feel slow for the first minute. Audit log entries are part of the dump, so the restored instance has the full history.

## Restore drill

Run the drill quarterly on a non-production host. The drill is not "does the dump exist" — it is "can a fresh host be rebuilt from the snapshot and a clean checkout in under an hour." The two failure modes the drill catches: a missing `providers/` snapshot (provider keys gone), and a stale `.env` that no longer matches the current binary's requirements.

## Where this fits

Backups are the cheap part; the restore drill is the expensive part, and the only one that proves the backup works. The hardening checklist that names backups as a row lives in [Hardening](/self-hosted/operate/security/hardening). If you are designing a multi-host setup, the architecture lives in [Container architecture](/self-hosted/operate/container-architecture).
